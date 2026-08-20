import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnnotationDataService,
  CellposeMask,
  MicroSamEmbedding,
  maskDataToPolygons,
} from './useHyphaService';

// onnxruntime-web is lazy-imported inside loadOrt() so CRA code-splits it into
// its own async chunk and the ~11 MB wasm is only fetched the first time a user
// actually draws a box. The wasm binary is vendored to public/onnx/ by
// scripts/copy-ort-wasm.js (prebuild + postinstall).
type Ort = typeof import('onnxruntime-web');

let ortModulePromise: Promise<Ort> | null = null;

async function loadOrt(): Promise<Ort> {
  if (!ortModulePromise) {
    ortModulePromise = (async () => {
      const ort = await import('onnxruntime-web');
      // No COOP/COEP headers exist anywhere in the app, so cross-origin
      // isolation is off and multi-threaded wasm is unavailable. Pin to a
      // single thread and point the loader at our vendored binary.
      ort.env.wasm.wasmPaths = `${process.env.PUBLIC_URL || ''}/onnx/`;
      ort.env.wasm.numThreads = 1;
      return ort;
    })().catch((e) => {
      ortModulePromise = null;
      throw e;
    });
  }
  return ortModulePromise;
}

/**
 * In-browser μSAM box-prompt decoder. Fetches the quantized ONNX decoder for
 * the currently selected generalist (round-34: only one decoder is ever kept
 * in memory, switching `modelType` evicts the previous session), computes
 * the image encoder embedding once per image+model pair, then decodes each
 * drawn box locally (no per-box network round-trip). Returns OL-space
 * polygons ready to add to the annotation vector source.
 */
export function useMicroSamDecoder(
  service: AnnotationDataService | null,
  imageRendered: boolean,
  modelType: string,
) {
  // Cached ort InferenceSession (decoder weights), keyed by modelType. Only
  // one entry is ever kept: switching models overwrites this ref, dropping
  // the previous session promise for GC (no Cache API is used anywhere in
  // this codebase, so eviction is purely this in-memory ref replacement).
  const sessionRef = useRef<{ modelType: string; promise: Promise<any> } | null>(null);
  // Cached encoder embedding, keyed by (image URL, modelType) so switching
  // either invalidates it and forces a fresh encode.
  const embeddingRef = useRef<{ url: string; modelType: string; promise: Promise<MicroSamEmbedding> } | null>(
    null,
  );
  // Optional embedding source injected by the page. When set, the box tool
  // pulls its embedding from here (a stored .npz) instead of encoding inline,
  // so it shares the single precomputed embedding with AIS pre-seg.
  const embeddingLoaderRef = useRef<
    ((url: string, width: number, height: number, modelType: string) => Promise<MicroSamEmbedding>) | null
  >(null);

  const setEmbeddingLoader = useCallback(
    (
      loader:
        | ((url: string, width: number, height: number, modelType: string) => Promise<MicroSamEmbedding>)
        | null,
    ) => {
      embeddingLoaderRef.current = loader;
    },
    [],
  );

  const ensureSession = useCallback(
    (mt: string): Promise<any> => {
      if (!service) throw new Error('The micro-sam segmentation service is unavailable');
      if (!sessionRef.current || sessionRef.current.modelType !== mt) {
        sessionRef.current = {
          modelType: mt,
          promise: (async () => {
            const ort = await loadOrt();
            const bytes = await service.getMicroSamOnnxModel(mt);
            return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
          })().catch((e) => {
            if (sessionRef.current?.modelType === mt) sessionRef.current = null;
            throw e;
          }),
        };
      }
      return sessionRef.current.promise;
    },
    [service],
  );

  // Warm the ONNX decoder session once the service is available AND the
  // current image has rendered, instead of firing at connect time. The
  // decoder download (~several MB) would otherwise compete for bandwidth
  // with the image fetch that the user is actually waiting on; deferring it
  // until `imageRendered` flips true lets the image show up first while the
  // decoder downloads in the background, ready by the time a box is drawn.
  // Also re-fires whenever `modelType` changes (model dialog selection),
  // downloading and swapping in the new decoder lazily in the background.
  const [decoderReady, setDecoderReady] = useState(false);
  const [loadedModelType, setLoadedModelType] = useState<string | null>(null);
  useEffect(() => {
    if (!service || !imageRendered) {
      setDecoderReady(false);
      return;
    }
    let cancelled = false;
    setDecoderReady(false);
    ensureSession(modelType)
      .then(() => {
        if (!cancelled) {
          setDecoderReady(true);
          setLoadedModelType(modelType);
        }
      })
      .catch(() => {
        if (!cancelled) setDecoderReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service, imageRendered, modelType, ensureSession]);

  const ensureEmbedding = useCallback(
    (url: string, width: number, height: number, mt: string): Promise<MicroSamEmbedding> => {
      if (!service) throw new Error('The micro-sam segmentation service is unavailable');
      if (!embeddingRef.current || embeddingRef.current.url !== url || embeddingRef.current.modelType !== mt) {
        // Prefer the injected loader (stored .npz) so the box tool reuses the
        // precomputed embedding; fall back to an inline encode if none is set.
        const load = embeddingLoaderRef.current
          ? embeddingLoaderRef.current(url, width, height, mt)
          : service.computeMicroSamEmbedding(url, width, height, mt);
        const promise = load.catch((e) => {
            // Drop the cache entry so the next box retries the encode.
            if (embeddingRef.current && embeddingRef.current.url === url && embeddingRef.current.modelType === mt) {
              embeddingRef.current = null;
            }
            throw e;
          });
        embeddingRef.current = { url, modelType: mt, promise };
      }
      return embeddingRef.current.promise;
    },
    [service],
  );

  /**
   * Decode a single box into one mask polygon set.
   *
   * @param extent OL-space box extent [minX, minY, maxX, maxY] in display
   *   pixels (bottom-left origin, as OpenLayers reports it).
   * @param displayW Source image width in display pixels.
   * @param displayH Source image height in display pixels.
   * @param url Image URL (embedding cache key).
   * @param modelType Which uSAM generalist to decode with (embedding + decoder cache key).
   */
  const decodeBox = useCallback(
    async (
      extent: number[],
      displayW: number,
      displayH: number,
      url: string,
      modelType: string,
    ): Promise<CellposeMask[]> => {
      const ort = await loadOrt();
      const [session, emb] = await Promise.all([
        ensureSession(modelType),
        ensureEmbedding(url, displayW, displayH, modelType),
      ]);

      // --- embedding tensor (1, 256, 64, 64) float32 ---
      const feats = emb.features;
      let featBuf: ArrayBuffer;
      if (feats._rvalue instanceof Uint8Array) {
        // Copy out of the (possibly offset) view into a fresh buffer.
        featBuf = feats._rvalue.buffer.slice(
          feats._rvalue.byteOffset,
          feats._rvalue.byteOffset + feats._rvalue.byteLength,
        );
      } else if (feats._rvalue instanceof ArrayBuffer) {
        featBuf = feats._rvalue;
      } else {
        featBuf = new Uint8Array(feats._rvalue).buffer;
      }
      const embeddingTensor = new ort.Tensor(
        'float32',
        new Float32Array(featBuf),
        feats._rshape as number[],
      );

      // SAM orig_im_size == the encoder's working resolution [scaledH, scaledW].
      const [origH, origW] = emb.originalImageShape;
      const origImSize = new ort.Tensor('float32', Float32Array.from([origH, origW]), [2]);
      const maskInput = new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]);
      const hasMaskInput = new ort.Tensor('float32', Float32Array.from([0]), [1]);

      // --- box prompt -> two labelled corner points ---
      // Map the OL-space box (bottom-left origin, display px) into the encoder's
      // top-left image space at working resolution, then scale by sam_scale.
      const [minX, minY, maxX, maxY] = extent;
      const sx = origW / displayW;
      const sy = origH / displayH;
      const left = minX * sx;
      const right = maxX * sx;
      // OL y grows upward, so the box top (maxY) becomes the smaller image row.
      const top = (displayH - maxY) * sy;
      const bottom = (displayH - minY) * sy;
      const s = emb.samScale;
      // SAM box encoding: top-left corner labelled 2, bottom-right labelled 3.
      const pointCoords = new ort.Tensor(
        'float32',
        Float32Array.from([left * s, top * s, right * s, bottom * s]),
        [1, 2, 2],
      );
      const pointLabels = new ort.Tensor('float32', Float32Array.from([2, 3]), [1, 2]);

      const feeds: Record<string, any> = {
        image_embeddings: embeddingTensor,
        point_coords: pointCoords,
        point_labels: pointLabels,
        orig_im_size: origImSize,
        mask_input: maskInput,
        has_mask_input: hasMaskInput,
      };

      const results = await session.run(feeds);
      const maskName = session.outputNames?.includes('masks')
        ? 'masks'
        : Object.keys(results)[0];
      const masks = results[maskName];
      const dims: number[] = masks.dims as number[];
      const H = dims[dims.length - 2];
      const W = dims[dims.length - 1];
      const logits = masks.data as Float32Array;
      const thr = emb.maskThreshold ?? 0;

      // First mask channel only (the decoder is exported single-mask, but guard
      // for a leading multimask dim by reading the first H*W block).
      const label = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        label[i] = logits[i] > thr ? 1 : 0;
      }

      // maskDataToPolygons Y-flips (scaledH - y) back to OL space and rescales
      // working -> display resolution, matching the box we drew.
      return maskDataToPolygons(label, W, H, displayW, displayH, 0);
    },
    [ensureSession, ensureEmbedding],
  );

  // Drop the cached embedding (called on image switch). The decoder session is
  // image-independent and stays cached (per current modelType) for the page
  // lifetime, until a model switch evicts it via ensureSession above.
  const reset = useCallback(() => {
    embeddingRef.current = null;
  }, []);

  return { decodeBox, reset, setEmbeddingLoader, decoderReady, loadedModelType };
}
