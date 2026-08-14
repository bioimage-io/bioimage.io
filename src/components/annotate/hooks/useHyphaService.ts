import { useEffect, useRef, useState } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { resolvePinnedCellposeService } from '../../../utils/cellposeServicePin';
import { resolveMicroSamService, MICRO_SAM_MODEL_TYPE } from '../../../utils/microSamService';
import { parseEmbeddingNpz } from '../../../utils/npzEmbedding';
import { HYPHA_SERVER_URL } from '../../../config/hypha';
import {
  DatasetIndex,
  EmbeddingUrls,
  SaveUrls as BrokerSaveUrls,
  getDatasetIndex as brokerGetDatasetIndex,
  getSaveUrls as brokerGetSaveUrls,
  getEmbeddingUrls as brokerGetEmbeddingUrls,
  withRetry,
} from '../../colab/brokerApi';

export interface AnnotationServiceConfig {
  artifactId: string;
  label: string;
}

export interface CellposeMask {
  label: number;
  coordinates: number[][][]; // polygon rings
}

/** Raw pieces the in-browser ONNX box-decoder needs for one image. The
 *  encoder features stay as the hypha-rpc ndarray wire-dict so the decoder
 *  hook can build the ort tensor without a second copy here. */
export interface MicroSamEmbedding {
  /** hypha ndarray wire-dict: float32 (1, 256, 64, 64). */
  features: any;
  /** [scaledH, scaledW] the encoder ran at (== SAM orig_im_size). */
  originalImageShape: number[];
  /** 1024 / max(scaledH, scaledW); multiplies prompt point coords. */
  samScale: number;
  /** Logit threshold for the decoder output (service reports 0.0). */
  maskThreshold: number;
  /** Working resolution the CHW input was downsampled to. */
  scaledW: number;
  scaledH: number;
}

export interface CellposeParams {
  model?: string;
  diameter?: number | null;
  flow_threshold?: number;
  cellprob_threshold?: number;
  niter?: number | null;
  min_mask_area?: number;
  enable_clahe?: boolean;
}

/**
 * Raw network outputs returned by the cellpose-finetuning service when
 * called with ``return_flows_only=True`` (>= 0.1.5). The annotate page
 * caches this so mask-gen parameters (flow_threshold, cellprob_threshold,
 * niter, min_mask_area) can be tuned client-side via Pyodide without a
 * GPU round-trip. See public/cellpose_mask_gen.py for the local compute.
 */
export interface CellposeFlowsResult {
  /** Flat float32 buffer of length ``2 * scaledH * scaledW`` (dy plane then dx plane). */
  dP: Float32Array;
  /** Flat float32 buffer of length ``scaledH * scaledW``. */
  cellprob: Float32Array;
  /** Size of the (already downsampled) network output. */
  scaledH: number;
  scaledW: number;
  /** Display-space size of the source image, so the caller can rescale the masks back. */
  displayW: number;
  displayH: number;
}

export interface AllAnnotatedResult {
  status: 'all_annotated';
  total: number;
  annotated: number;
  label: string;
  message: string;
}

export interface NoImagesResult {
  status: 'no_images';
  message: string;
}

export interface AnnotationDataService {
  /** Full broker-index snapshot: every image in the dataset plus this
   *  caller's own latest annotation per (label, stem). Wrapped in
   *  `withRetry` since the broker's read paths don't self-heal internally
   *  (colab-rework-plan.md F5). */
  getDatasetIndex: () => Promise<DatasetIndex>;
  /** Presigned PUT urls (+ the timestamp the broker minted) to save one
   *  annotation pair for `imageStem` under this session's label. Every
   *  save is a new timestamped pair; nothing is overwritten. */
  getSaveUrls: (imageStem: string) => Promise<BrokerSaveUrls>;
  /** Presigned urls for the stored μSAM embedding of `imageStem` (pinned
   *  model type): either a GET url if it already exists, or a PUT url to
   *  upload a freshly computed one. */
  getEmbeddingUrls: (imageStem: string) => Promise<EmbeddingUrls>;
  runCellpose: (imageUrl: string, width: number, height: number, params?: CellposeParams) => Promise<CellposeMask[]>;
  /** μSAM automatic-instance-segmentation drop-in. Wire-compatible with
   *  ``runCellpose`` (same CHW uint8 input, same ``[{output: int32 [H,W]}]``
   *  response), so it returns the same ``CellposeMask[]`` polygons. Only
   *  ``min_mask_area`` from ``params`` is honoured; μSAM AIS ignores the
   *  Cellpose-specific knobs (diameter, flow/cellprob, niter). */
  runMicroSam: (imageUrl: string, width: number, height: number, params?: CellposeParams) => Promise<CellposeMask[]>;
  /** Fetch the quantized μSAM ONNX prompt-decoder bytes for the in-browser box
   *  tool. One round-trip per page; the decoder hook caches the ort session. */
  getMicroSamOnnxModel: () => Promise<Uint8Array>;
  /** Run the μSAM image encoder once for the interactive box tool. Returns the
   *  encoder features plus the geometry the ONNX decoder needs. Cached per
   *  image URL by the decoder hook. */
  computeMicroSamEmbedding: (imageUrl: string, width: number, height: number) => Promise<MicroSamEmbedding>;
  /** Run the μSAM encoder and have the service write the ``.npz`` straight into
   *  the session artifact via ``embedding_upload_url``. No features returned. */
  computeMicroSamEmbeddingToArtifact: (imageUrl: string, width: number, height: number, uploadUrl: string) => Promise<void>;
  /** Download + unzip a stored ``.npz`` embedding into the decoder-ready shape
   *  (reconstructs the same ``MicroSamEmbedding`` the inline encode returned). */
  loadMicroSamEmbedding: (npzUrl: string) => Promise<MicroSamEmbedding>;
  /** μSAM AIS pre-seg from a stored embedding link. Server reads the ``.npz``
   *  and returns the same ``[{output}]`` list; the browser never pulls it. */
  runMicroSamFromEmbedding: (npzUrl: string, width: number, height: number, params?: CellposeParams) => Promise<CellposeMask[]>;
  /** Fetch raw (dP, cellprob) for client-side mask-gen tuning (>= 0.1.5).
   *  Only ``model``, ``diameter`` and ``enable_clahe`` influence the
   *  network output; the mask-gen knobs are ignored and consumed by the
   *  client-side compute_masks_np instead. */
  runCellposeFlows: (imageUrl: string, width: number, height: number, params?: CellposeParams) => Promise<CellposeFlowsResult>;
}

/** Convert raw cellpose mask data into ``CellposeMask`` polygons, rescaled
 *  back to display coordinates. Exported so the annotate page can reuse
 *  the polygonisation pass after a local Pyodide compute_masks_np run. */
export function maskDataToPolygons(
  maskData: Uint16Array | Uint32Array | Int32Array | Float32Array | number[],
  scaledW: number,
  scaledH: number,
  displayW: number,
  displayH: number,
  minMaskAreaDisplayPx: number = 0,
): CellposeMask[] {
  let polygons = maskToPolygons(maskData, scaledW, scaledH);
  const areaScale = (scaledW / displayW) * (scaledH / displayH);
  polygons = filterByArea(polygons, minMaskAreaDisplayPx * areaScale);
  const scaleX = displayW / scaledW;
  const scaleY = displayH / scaledH;
  if (scaleX !== 1 || scaleY !== 1) {
    polygons = polygons.map((poly) => ({
      ...poly,
      coordinates: poly.coordinates.map((ring) =>
        ring.map(([px, py]) => [px * scaleX, py * scaleY]),
      ),
    }));
  }
  return polygons;
}

/** Decode a hypha-rpc label-mask ndarray (``{_rtype:'ndarray', _rvalue, _rshape:[H,W], _rdtype}``)
 *  into a typed array plus its width/height. Shared by the Cellpose and μSAM
 *  infer paths, whose ``result[0].output`` have the identical wire shape. */
function decodeLabelMask(maskResult: any): {
  maskData: Int32Array | Uint16Array | Uint32Array | Float32Array;
  w: number;
  h: number;
} {
  let buffer = maskResult._rvalue;
  const shape = maskResult._rshape as number[];
  const dtype = maskResult._rdtype as string;
  const w = shape[1];
  const h = shape[0];
  // _rvalue may be a Uint8Array view; slice out its underlying ArrayBuffer.
  if (buffer instanceof Uint8Array) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  let maskData: Int32Array | Uint16Array | Uint32Array | Float32Array;
  if (dtype === 'int32' || dtype === 'int') {
    maskData = new Int32Array(buffer);
  } else if (dtype === 'uint16') {
    maskData = new Uint16Array(buffer);
  } else if (dtype === 'float32') {
    maskData = new Float32Array(buffer);
  } else if (dtype === 'uint32') {
    maskData = new Uint32Array(buffer);
  } else {
    maskData = new Int32Array(buffer);
  }
  return { maskData, w, h };
}

/** Extract image pixel data as a Uint8Array in CHW RGB format (3, H, W) for cellpose */
/** Max pixel dimension sent to Cellpose-SAM. Larger images are downsampled to this size.
 *  256 gives ~30-60s inference on HPA fluorescence images with 10-20 cells detected.
 *  512 gives 5-15 min for the same images (too slow for interactive use). */
const CELLPOSE_MAX_DIM = 256;

/** Long-side pixel cap for the μSAM image encoder. SAM resizes its input to
 *  1024 internally, so 1024 is the quality sweet spot (256 loses detail); the
 *  box-decoder coordinate math is resolution-invariant, so this only affects
 *  embedding quality, not correctness. */
const MICRO_SAM_MAX_DIM = 1024;

function getImagePixelsCHW(
  imageUrl: string,
  width: number,
  height: number,
  maxDim: number = CELLPOSE_MAX_DIM,
): Promise<{ chw: Uint8Array; scaledW: number; scaledH: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Downsample if either dimension exceeds maxDim
      const scale = Math.min(1, maxDim / Math.max(width, height));
      const scaledW = Math.round(width * scale);
      const scaledH = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, scaledW, scaledH);
      const imageData = ctx.getImageData(0, 0, scaledW, scaledH);
      const rgba = imageData.data;
      const numPixels = scaledW * scaledH;
      // Convert RGBA (HWC interleaved) to CHW planar: [R plane, G plane, B plane]
      const chw = new Uint8Array(numPixels * 3);
      for (let i = 0; i < numPixels; i++) {
        chw[i] = rgba[i * 4];                    // R plane
        chw[numPixels + i] = rgba[i * 4 + 1];    // G plane
        chw[numPixels * 2 + i] = rgba[i * 4 + 2]; // B plane
      }
      resolve({ chw, scaledW, scaledH });
    };
    img.onerror = () => reject(new Error('Failed to load image for pixel extraction'));
    img.src = imageUrl;
  });
}

/** Convert cellpose mask (2D label array) to polygon contours using marching squares */
function maskToPolygons(maskData: number[] | Uint16Array | Uint32Array | Float32Array, width: number, height: number): CellposeMask[] {
  // Find unique labels (skip 0 = background)
  const labelSet = new Set<number>();
  for (let i = 0; i < maskData.length; i++) {
    if (maskData[i] > 0) labelSet.add(maskData[i]);
  }

  const results: CellposeMask[] = [];

  for (const label of Array.from(labelSet)) {
    // Create binary mask for this label
    const binary = new Uint8Array(width * height);
    let minX = width, maxX = 0, minY = height, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (maskData[y * width + x] === label) {
          binary[y * width + x] = 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Simple contour tracing: walk the boundary pixels
    const contour = traceContour(binary, width, height, minX, minY, maxX, maxY);
    if (contour.length >= 3) {
      // Convert from canvas coords (top-left origin) to OL coords (bottom-left origin)
      const olCoords = contour.map(([x, y]) => [x, height - y]);
      // Close the ring
      olCoords.push(olCoords[0]);
      results.push({ label, coordinates: [olCoords] });
    }
  }

  return results;
}

/** Trace contour of a binary mask region using boundary following */
function traceContour(binary: Uint8Array, width: number, height: number, minX: number, minY: number, maxX: number, maxY: number): number[][] {
  // Find first boundary pixel
  let startX = -1, startY = -1;
  outer:
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (binary[y * width + x] === 1) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX === -1) return [];

  const points: number[][] = [];
  const dirs = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];

  const getPixel = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return binary[y * width + x];
  };

  let x = startX, y = startY;
  let dir = 0; // start looking up
  const maxSteps = (maxX - minX + 3) * (maxY - minY + 3) * 2;
  let steps = 0;

  do {
    points.push([x, y]);
    // Find next boundary pixel
    let found = false;
    const searchStart = (dir + 5) % 8; // start searching from dir-3
    for (let i = 0; i < 8; i++) {
      const d = (searchStart + i) % 8;
      const nx = x + dirs[d][0];
      const ny = y + dirs[d][1];
      if (getPixel(nx, ny) === 1) {
        x = nx;
        y = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break;
    steps++;
  } while ((x !== startX || y !== startY) && steps < maxSteps);

  // Simplify: take every Nth point for large contours
  if (points.length > 200) {
    const step = Math.ceil(points.length / 200);
    const simplified: number[][] = [];
    for (let i = 0; i < points.length; i += step) {
      simplified.push(points[i]);
    }
    return simplified;
  }

  return points;
}

/** Filter out masks with polygon area below min_mask_area (in pixels²) */
function filterByArea(masks: CellposeMask[], minArea?: number): CellposeMask[] {
  if (!minArea || minArea <= 0) return masks;
  return masks.filter((mask) => {
    // Approximate area using shoelace formula on outer ring
    const ring = mask.coordinates[0];
    if (!ring || ring.length < 3) return false;
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(area) / 2 >= minArea;
  });
}

export function useHyphaService(config: AnnotationServiceConfig | null): {
  service: AnnotationDataService | null;
  loading: boolean;
  error: string | null;
  cellposeAvailable: boolean;
  microSamAvailable: boolean;
} {
  const [service, setService] = useState<AnnotationDataService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cellposeAvailable, setCellposeAvailable] = useState(false);
  const [microSamAvailable, setMicroSamAvailable] = useState(false);
  const serverRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      if (!config) {
        setLoading(false);
        setError('No service configuration provided');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Pull the user's auth token from localStorage so logged-in users
        // connect into their own Hypha workspace (ws-user-<id>). Anonymous
        // visitors connect without a token; the broker only allows
        // unauthenticated reads/writes on public datasets
        // (colab-rework-plan.md §8).
        let storedToken: string | undefined;
        try {
          const t = window.localStorage.getItem('token');
          const expiryRaw = window.localStorage.getItem('tokenExpiry');
          const stillValid = !expiryRaw || new Date(expiryRaw).getTime() > Date.now();
          if (t && stillValid) storedToken = t;
        } catch {
          // localStorage may be unavailable in private modes; carry on anonymous.
        }
        const connectCfg: any = { server_url: HYPHA_SERVER_URL };
        if (storedToken) connectCfg.token = storedToken;
        const server = await hyphaWebsocketClient.connectToServer(connectCfg);
        if (cancelled) {
          await server.disconnect();
          return;
        }
        serverRef.current = server;
        console.log('[useHyphaService] Connected to workspace:', server.config.workspace);

        // The session_id in the URL may be a bare alias or a full
        // workspace/alias; normalize against the connected server's own
        // workspace (mirrors the pattern in ColabPage.tsx).
        const artifactId = config.artifactId.includes('/')
          ? config.artifactId
          : `${server.config.workspace}/${config.artifactId}`;
        console.log('[useHyphaService] Resolved artifact id:', artifactId);

        // Cellpose service: probe once at connect time. The probe
        // intentionally pins the replica id in sessionStorage so every
        // subsequent call (here and from the colab Training UI) lands on
        // the same worker. That matters because cellpose-finetuning
        // persists training state to local disk — see
        // utils/cellposeServicePin.ts for the rationale.
        try {
          await resolvePinnedCellposeService(server);
          console.log('[useHyphaService] cellpose-finetuning reachable');
          if (!cancelled) setCellposeAvailable(true);
        } catch (err) {
          console.warn('[useHyphaService] cellpose-finetuning not reachable:', err);
          if (!cancelled) setCellposeAvailable(false);
        }

        /** Resolve a fresh handle to the *pinned* cellpose-finetuning
         *  replica per call. Hypha service handles expire after a few
         *  minutes of inactivity; the symptom is ``Method expired or not
         *  found`` on the next infer. Cheap to resolve (one websocket
         *  round-trip) so we re-resolve unconditionally instead of
         *  caching + retrying. */
        const resolveCellposeService = async () => {
          try {
            return await resolvePinnedCellposeService(server);
          } catch (err) {
            throw new Error(
              `Cellpose service is not available (${(err as Error)?.message || err})`,
            );
          }
        };

        // micro-sam (μSAM) service: probe once at connect time. Unlike
        // cellpose-finetuning there is nothing to pin (μSAM is stateless
        // across replicas), so both the probe and the per-call resolver just
        // re-resolve a fresh handle from the fully-qualified service id.
        try {
          await resolveMicroSamService(server);
          console.log('[useHyphaService] micro-sam reachable');
          if (!cancelled) setMicroSamAvailable(true);
        } catch (err) {
          console.warn('[useHyphaService] micro-sam not reachable:', err);
          if (!cancelled) setMicroSamAvailable(false);
        }

        const wrappedService: AnnotationDataService = {
          getDatasetIndex: async () => withRetry(() => brokerGetDatasetIndex(server, artifactId)),
          getSaveUrls: async (imageStem: string) =>
            withRetry(() => brokerGetSaveUrls(server, artifactId, config.label, imageStem)),
          getEmbeddingUrls: async (imageStem: string) =>
            withRetry(() => brokerGetEmbeddingUrls(server, artifactId, imageStem, MICRO_SAM_MODEL_TYPE)),
          runCellpose: async (imageUrl: string, width: number, height: number, params?: CellposeParams) => {
            const cellposeService = await resolveCellposeService();
            const p = params || {};
            console.log('[useHyphaService] Running cellpose inference with params:', p);

            // Get image pixels as CHW RGB uint8 array (cellpose expects C,H,W format).
            // Images are downsampled to CELLPOSE_MAX_DIM to keep inference fast.
            const { chw, scaledW, scaledH } = await getImagePixelsCHW(imageUrl, width, height);
            console.log('[useHyphaService] Image pixels extracted: CHW shape [3, %d, %d] (display: %dx%d)', scaledH, scaledW, width, height);

            // Create ndarray-like object for hypha-rpc
            // _rvalue MUST be Uint8Array (not ArrayBuffer) so msgpack serializes it as binary
            const inputArray = {
              _rtype: 'ndarray',
              _rvalue: chw,
              _rshape: [3, scaledH, scaledW],
              _rdtype: 'uint8',
            };

            // Build infer kwargs, only include non-default params
            const inferArgs: Record<string, any> = {
              input_arrays: [inputArray],
              _rkwargs: true,
            };
            if (p.model) inferArgs.model = p.model;
            if (p.diameter != null && p.diameter > 0) {
              // Diameter is measured in display-space pixels. Scale it to the
              // downsampled image so Cellpose rescales the image correctly.
              const diameterScale = scaledW / width;
              inferArgs.diameter = p.diameter * diameterScale;
            }
            if (p.flow_threshold != null) inferArgs.flow_threshold = p.flow_threshold;
            if (p.cellprob_threshold != null) inferArgs.cellprob_threshold = p.cellprob_threshold;
            if (p.niter != null && p.niter > 0) inferArgs.niter = p.niter;
            if (p.enable_clahe) inferArgs.enable_clahe = true;

            // Call cellpose infer
            const result = await cellposeService.infer(inferArgs);

            console.log('[useHyphaService] Cellpose raw result:', result);

            // result is list[PredictionItemModel], each with { input_path, output }
            // output is an ndarray (int32 label mask, shape [H, W])
            if (!result || !Array.isArray(result) || result.length === 0) {
              console.log('[useHyphaService] No results from cellpose');
              return [];
            }

            const item = result[0];
            console.log('[useHyphaService] First result item keys:', Object.keys(item));
            const maskResult = item.output;

            if (!maskResult) {
              console.warn('[useHyphaService] No output field in result item:', item);
              return [];
            }

            // maskResult should be an ndarray with shape [H, W]
            let maskData: any;
            if (maskResult._rtype === 'ndarray') {
              // Decode the hypha-rpc ndarray
              let buffer = maskResult._rvalue;
              const shape = maskResult._rshape;
              const dtype = maskResult._rdtype;
              const w = shape[1];
              const h = shape[0];
              console.log('[useHyphaService] Mask ndarray: dtype=%s, shape=%s', dtype, JSON.stringify(shape));

              // _rvalue may be Uint8Array; get underlying ArrayBuffer
              if (buffer instanceof Uint8Array) {
                buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
              }

              if (dtype === 'int32' || dtype === 'int') {
                maskData = new Int32Array(buffer);
              } else if (dtype === 'uint16') {
                maskData = new Uint16Array(buffer);
              } else if (dtype === 'float32') {
                maskData = new Float32Array(buffer);
              } else if (dtype === 'uint32') {
                maskData = new Uint32Array(buffer);
              } else {
                maskData = new Int32Array(buffer);
              }

              let polygons = maskToPolygons(maskData, w, h);
              // Scale min_mask_area to mask space (area shrinks by scale²) so threshold
              // is applied consistently regardless of downsampling factor.
              const areaScale = (scaledW / width) * (scaledH / height);
              polygons = filterByArea(polygons, (p.min_mask_area ?? 0) * areaScale);
              // Scale polygon coordinates back to original image dimensions if downsampled
              const scaleX = width / scaledW;
              const scaleY = height / scaledH;
              if (scaleX !== 1 || scaleY !== 1) {
                polygons = polygons.map((poly) => ({
                  ...poly,
                  coordinates: poly.coordinates.map((ring) =>
                    ring.map(([px, py]) => [px * scaleX, py * scaleY])
                  ),
                }));
              }
              console.log('[useHyphaService] Converted mask to', polygons.length, 'polygons (scale %dx%d → %dx%d)', scaledW, scaledH, width, height);
              return polygons;
            }

            // If it's already an array
            if (Array.isArray(maskResult)) {
              const flat = maskResult.flat();
              let polygons = maskToPolygons(flat, scaledW, scaledH);
              const areaScale = (scaledW / width) * (scaledH / height);
              polygons = filterByArea(polygons, (p.min_mask_area ?? 0) * areaScale);
              const scaleX = width / scaledW;
              const scaleY = height / scaledH;
              if (scaleX !== 1 || scaleY !== 1) {
                polygons = polygons.map((poly) => ({
                  ...poly,
                  coordinates: poly.coordinates.map((ring) =>
                    ring.map(([px, py]) => [px * scaleX, py * scaleY])
                  ),
                }));
              }
              console.log('[useHyphaService] Converted flat array mask to', polygons.length, 'polygons');
              return polygons;
            }

            console.warn('[useHyphaService] Unknown mask format:', typeof maskResult, maskResult);
            return [];
          },
          runMicroSam: async (imageUrl: string, width: number, height: number, params?: CellposeParams) => {
            const microSamService = await resolveMicroSamService(server);
            const p = params || {};
            console.log('[useHyphaService] Running micro-sam AIS inference');

            // Same CHW RGB uint8 input as Cellpose; μSAM is a drop-in.
            const { chw, scaledW, scaledH } = await getImagePixelsCHW(imageUrl, width, height);
            const inputArray = {
              _rtype: 'ndarray',
              _rvalue: chw,
              _rshape: [3, scaledH, scaledW],
              _rdtype: 'uint8',
            };

            // μSAM AIS takes no Cellpose-style knobs; just the image. Pin
            // model_type to the same constant the box path uses so auto pre-seg
            // and the interactive decoder never diverge from the server default.
            const result = await microSamService.infer({
              input_arrays: [inputArray],
              model_type: MICRO_SAM_MODEL_TYPE,
              _rkwargs: true,
            });
            console.log('[useHyphaService] micro-sam raw result:', result);

            // Response mirrors Cellpose: a bare list, result[0].output is an
            // int32 label mask ndarray of shape [H, W].
            if (!result || !Array.isArray(result) || result.length === 0) {
              console.log('[useHyphaService] No results from micro-sam');
              return [];
            }
            const maskResult = result[0]?.output;
            if (!maskResult || maskResult._rtype !== 'ndarray') {
              console.warn('[useHyphaService] micro-sam output is not an ndarray:', maskResult);
              return [];
            }

            const { maskData, w, h } = decodeLabelMask(maskResult);
            console.log('[useHyphaService] micro-sam mask ndarray: dtype=%s, [%d, %d]', maskResult._rdtype, h, w);
            // maskDataToPolygons handles area filtering + rescale back to display space.
            const polygons = maskDataToPolygons(maskData, w, h, width, height, p.min_mask_area ?? 0);
            console.log('[useHyphaService] micro-sam converted to', polygons.length, 'polygons');
            return polygons;
          },
          getMicroSamOnnxModel: async (): Promise<Uint8Array> => {
            const microSamService = await resolveMicroSamService(server);
            console.log('[useHyphaService] Fetching micro-sam ONNX decoder');
            const bytes = await microSamService.get_onnx_model({
              model_type: MICRO_SAM_MODEL_TYPE,
              quantize: true,
              _rkwargs: true,
            });
            // hypha-rpc delivers bytes as a Uint8Array (msgpack bin); normalize
            // ArrayBuffer just in case a transport hands one back.
            if (bytes instanceof Uint8Array) return bytes;
            if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
            return new Uint8Array(bytes);
          },
          computeMicroSamEmbedding: async (
            imageUrl: string,
            width: number,
            height: number,
          ): Promise<MicroSamEmbedding> => {
            const microSamService = await resolveMicroSamService(server);
            console.log('[useHyphaService] Computing micro-sam image embedding');

            // Same CHW RGB uint8 input as infer; the encoder downsamples the
            // same way, so scaledW/scaledH define the working resolution the
            // box tool maps its prompt coordinates into.
            const { chw, scaledW, scaledH } = await getImagePixelsCHW(imageUrl, width, height);
            const inputArray = {
              _rtype: 'ndarray',
              _rvalue: chw,
              _rshape: [3, scaledH, scaledW],
              _rdtype: 'uint8',
            };

            const emb = await microSamService.compute_embedding({
              inputs: inputArray,
              model_type: MICRO_SAM_MODEL_TYPE,
              _rkwargs: true,
            });
            if (!emb || !emb.features || emb.features._rtype !== 'ndarray') {
              throw new Error('micro-sam embedding response missing features ndarray');
            }
            console.log(
              '[useHyphaService] micro-sam embedding: shape=%s scale=%s',
              JSON.stringify(emb.original_image_shape),
              emb.sam_scale,
            );

            return {
              features: emb.features,
              originalImageShape: emb.original_image_shape,
              samScale: emb.sam_scale,
              maskThreshold: emb.mask_threshold ?? 0,
              scaledW,
              scaledH,
            };
          },
          computeMicroSamEmbeddingToArtifact: async (
            imageUrl: string,
            width: number,
            height: number,
            uploadUrl: string,
          ): Promise<void> => {
            const microSamService = await resolveMicroSamService(server);
            console.log('[useHyphaService] Computing micro-sam embedding -> session artifact');

            // Encode at the μSAM working resolution; the service writes the
            // self-contained .npz straight to our presigned PUT url, so no
            // features come back inline (nothing to decode here).
            const { chw, scaledW, scaledH } = await getImagePixelsCHW(
              imageUrl,
              width,
              height,
              MICRO_SAM_MAX_DIM,
            );
            const inputArray = {
              _rtype: 'ndarray',
              _rvalue: chw,
              _rshape: [3, scaledH, scaledW],
              _rdtype: 'uint8',
            };
            await microSamService.compute_embedding({
              inputs: inputArray,
              model_type: MICRO_SAM_MODEL_TYPE,
              embedding_upload_url: uploadUrl,
              _rkwargs: true,
            });
          },
          loadMicroSamEmbedding: async (npzUrl: string): Promise<MicroSamEmbedding> => {
            console.log('[useHyphaService] Downloading stored micro-sam embedding .npz');
            const res = await fetch(npzUrl);
            if (!res.ok) {
              throw new Error(`Failed to download embedding (${res.status})`);
            }
            const buf = await res.arrayBuffer();
            const parsed = await parseEmbeddingNpz(buf);

            const maxIn = Math.max(...parsed.inputSize);
            const maxOrig = Math.max(...parsed.originalSize);
            // sam_scale maps original-image coords into the SAM-resized frame.
            // mask_threshold is 0.0 for the pinned *_lm model (not in the .npz).
            const samScale = maxOrig > 0 ? maxIn / maxOrig : 1;
            const [origH, origW] = parsed.originalSize;

            return {
              // Rebuild the same hypha-style ndarray wire-dict the decoder reads:
              // decodeBox slices _rvalue (Uint8Array) -> Float32Array by _rshape.
              features: {
                _rtype: 'ndarray',
                _rvalue: parsed.features,
                _rshape: parsed.featuresShape,
                _rdtype: 'float32',
              },
              originalImageShape: parsed.originalSize,
              samScale,
              maskThreshold: 0,
              scaledW: origW,
              scaledH: origH,
            };
          },
          runMicroSamFromEmbedding: async (
            npzUrl: string,
            width: number,
            height: number,
            params?: CellposeParams,
          ): Promise<CellposeMask[]> => {
            const microSamService = await resolveMicroSamService(server);
            const p = params || {};
            console.log('[useHyphaService] Running micro-sam AIS from stored embedding link');

            // Server-side AIS reads the stored .npz directly; the browser never
            // downloads the ~4 MB embedding for this path.
            // min_mask_area is a display-space area, so it is applied
            // client-side by maskDataToPolygons (as the pixel path does), not
            // passed as the server's embedding-resolution min_size.
            const result = await microSamService.infer({
              embeddings: [npzUrl],
              model_type: MICRO_SAM_MODEL_TYPE,
              _rkwargs: true,
            });

            // Same bare-list response as the pixel path: result[0].output.
            if (!result || !Array.isArray(result) || result.length === 0) {
              console.log('[useHyphaService] No results from micro-sam (embedding link)');
              return [];
            }
            const maskResult = result[0]?.output;
            if (!maskResult || maskResult._rtype !== 'ndarray') {
              console.warn('[useHyphaService] micro-sam output is not an ndarray:', maskResult);
              return [];
            }
            const { maskData, w, h } = decodeLabelMask(maskResult);
            return maskDataToPolygons(maskData, w, h, width, height, p.min_mask_area ?? 0);
          },
          runCellposeFlows: async (
            imageUrl: string,
            width: number,
            height: number,
            params?: CellposeParams,
          ): Promise<CellposeFlowsResult> => {
            const cellposeService = await resolveCellposeService();
            const p = params || {};
            console.log('[useHyphaService] Running cellpose flows-only inference:', p);

            const { chw, scaledW, scaledH } = await getImagePixelsCHW(imageUrl, width, height);
            const inputArray = {
              _rtype: 'ndarray',
              _rvalue: chw,
              _rshape: [3, scaledH, scaledW],
              _rdtype: 'uint8',
            };

            const inferArgs: Record<string, any> = {
              input_arrays: [inputArray],
              return_flows_only: true,
              _rkwargs: true,
            };
            if (p.model) inferArgs.model = p.model;
            if (p.diameter != null && p.diameter > 0) {
              const diameterScale = scaledW / width;
              inferArgs.diameter = p.diameter * diameterScale;
            }
            if (p.enable_clahe) inferArgs.enable_clahe = true;

            const result = await cellposeService.infer(inferArgs);
            if (!result || !Array.isArray(result) || result.length === 0) {
              throw new Error('Cellpose service returned no items');
            }
            const item = result[0];
            const output = item?.output;
            if (!output || typeof output !== 'object') {
              throw new Error(
                'Cellpose service did not return a flows payload (expected output={dP, cellprob}). '
                  + 'Is the deployed version >= 0.1.5?',
              );
            }

            const decodeFloat32 = (nd: any, fieldName: string): { data: Float32Array; shape: number[] } => {
              if (!nd || nd._rtype !== 'ndarray') {
                throw new Error(`${fieldName} is not an ndarray (got ${typeof nd})`);
              }
              let buffer = nd._rvalue;
              const shape = nd._rshape as number[];
              if (buffer instanceof Uint8Array) {
                buffer = buffer.buffer.slice(
                  buffer.byteOffset,
                  buffer.byteOffset + buffer.byteLength,
                );
              }
              // float16 wire option is not part of v1; the server sends float32.
              if (nd._rdtype !== 'float32') {
                console.warn(
                  `[useHyphaService] ${fieldName} dtype is ${nd._rdtype}, converting`,
                );
              }
              const data = new Float32Array(buffer);
              return { data, shape };
            };

            const dPDecoded = decodeFloat32(output.dP, 'dP');
            const cellprobDecoded = decodeFloat32(output.cellprob, 'cellprob');

            // Sanity-check shapes match what the network was asked to produce.
            if (dPDecoded.shape.length !== 3 || dPDecoded.shape[0] !== 2) {
              throw new Error(
                `dP shape ${JSON.stringify(dPDecoded.shape)} not (2, H, W)`,
              );
            }
            if (
              cellprobDecoded.shape.length !== 2
              || cellprobDecoded.shape[0] !== dPDecoded.shape[1]
              || cellprobDecoded.shape[1] !== dPDecoded.shape[2]
            ) {
              throw new Error(
                `cellprob shape ${JSON.stringify(cellprobDecoded.shape)} disagrees with dP ${JSON.stringify(dPDecoded.shape)}`,
              );
            }

            const outH = dPDecoded.shape[1];
            const outW = dPDecoded.shape[2];
            console.log(
              '[useHyphaService] Got flows: dP (2,%d,%d) cellprob (%d,%d), %d KB',
              outH, outW, outH, outW,
              Math.round((dPDecoded.data.byteLength + cellprobDecoded.data.byteLength) / 1024),
            );

            return {
              dP: dPDecoded.data,
              cellprob: cellprobDecoded.data,
              scaledH: outH,
              scaledW: outW,
              displayW: width,
              displayH: height,
            };
          },
        };

        if (!cancelled) {
          setService(wrappedService);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[useHyphaService] Connection failed:', err);
          setError(err.message || 'Failed to connect to Hypha service');
          setLoading(false);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (serverRef.current) {
        serverRef.current.disconnect().catch(() => {});
        serverRef.current = null;
      }
    };
  }, [config?.artifactId, config?.label]);

  return { service, loading, error, cellposeAvailable, microSamAvailable };
}
