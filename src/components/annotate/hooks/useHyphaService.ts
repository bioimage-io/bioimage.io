import { useEffect, useRef, useState } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { resolveCellpose4RunnerService, pollCellpose4Infer, CELLPOSE4_RUNNER_MODEL_ID } from '../../../utils/cellpose4RunnerService';
import { resolveMicroSamService, MICRO_SAM_MODEL_TYPE } from '../../../utils/microSamService';
import { parseEmbeddingNpz } from '../../../utils/npzEmbedding';
import { HYPHA_SERVER_URL } from '../../../config/hypha';
import {
  DatasetIndex,
  EmbeddingUrls,
  SaveUrls as BrokerSaveUrls,
  ImageUrl as BrokerImageUrl,
  MyAnnotationUrl as BrokerMyAnnotationUrl,
  getDatasetIndex as brokerGetDatasetIndex,
  getImageUrl as brokerGetImageUrl,
  getMyAnnotationUrl as brokerGetMyAnnotationUrl,
  getSaveUrls as brokerGetSaveUrls,
  getEmbeddingUrls as brokerGetEmbeddingUrls,
  requestAccess as brokerRequestAccess,
  withRetry,
} from '../../colab/brokerApi';
import { toArtifactId } from '../../colab/datasetApi';

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
  flow_threshold?: number;
  cellprob_threshold?: number;
  niter?: number | null;
  min_mask_area?: number;
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
  /** Fresh presigned read url for one image (broker v0.5.0). Public-min role,
   *  safe to call before the caller's role on the dataset is known, which is
   *  what lets an `&image=<stem>` deep link render before the index or the
   *  role check resolves. */
  getImageUrl: (imageStem: string) => Promise<BrokerImageUrl>;
  /** The caller's own latest annotation for one image under this session's
   *  label (broker v0.5.0), replacing the presigned urls `getDatasetIndex`
   *  used to embed in `my_annotations`. */
  getMyAnnotationUrl: (imageStem: string) => Promise<BrokerMyAnnotationUrl>;
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
   *  Cellpose-specific knobs (flow/cellprob, niter). */
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
  /** Fetch raw (dP, cellprob) for client-side mask-gen tuning. The network
   *  output only depends on the image (always the published 'idealistic-eagle'
   *  model via cellpose4-runner); ``params`` mask-gen knobs are ignored here
   *  and consumed by the client-side compute_masks_np instead. */
  runCellposeFlows: (imageUrl: string, width: number, height: number, params?: CellposeParams) => Promise<CellposeFlowsResult>;
  /** Ask the broker for a role on this dataset (colab-rework-plan.md §13).
   *  Only meaningful for a logged-in caller; the broker rejects anonymous
   *  requests with a message asking the user to log in first. */
  requestAccess: (role?: 'annotator' | 'manager') => Promise<{ status: 'requested' | 'already_has_access'; [key: string]: any }>;
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
  let shape = maskResult._rshape as number[];
  const dtype = maskResult._rdtype as string;
  // cellpose4-runner returns a leading batch axis, e.g. (1, 1, H, W) instead
  // of the bare (H, W) this function used to assume. Drop leading singleton
  // dims so w/h always read the real trailing spatial dims; without this,
  // w and h silently read as 1 and every mask decodes to zero polygons with
  // no thrown error.
  while (shape.length > 2 && shape[0] === 1) {
    shape = shape.slice(1);
  }
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

/** Zero out every pixel except those in the largest 8-connected component,
 *  so a handful of stray noise pixels can't outweigh the real blob. */
function largestConnectedComponent(binary: Uint8Array, width: number, height: number): Uint8Array {
  const visited = new Uint8Array(width * height);
  let bestIndices: number[] | null = null;
  const stack: number[] = [];

  for (let start = 0; start < binary.length; start++) {
    if (binary[start] !== 1 || visited[start]) continue;
    const componentIndices: number[] = [];
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      componentIndices.push(idx);
      const cx = idx % width;
      const cy = (idx / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (binary[nIdx] === 1 && !visited[nIdx]) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }
    if (!bestIndices || componentIndices.length > bestIndices.length) {
      bestIndices = componentIndices;
    }
  }

  const result = new Uint8Array(width * height);
  if (bestIndices) {
    for (const idx of bestIndices) result[idx] = 1;
  }
  return result;
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
    let binary = new Uint8Array(width * height);
    for (let i = 0; i < maskData.length; i++) {
      if (maskData[i] === label) binary[i] = 1;
    }

    // Restrict to the largest connected component. traceContour always
    // starts at the first fg pixel found by raster scan (top-left-most) and
    // stops as soon as it loops back to that start point, so a single
    // isolated above-threshold noise pixel elsewhere in the frame (common in
    // the SAM box decoder's raw logit mask, which isn't guaranteed to be one
    // clean blob) hijacks the trace into a degenerate few-point polygon
    // instead of the real region.
    binary = largestConnectedComponent(binary, width, height);

    let minX = width, maxX = 0, minY = height, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (binary[y * width + x] === 1) {
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
  // The raster scan above always finds the start pixel by sweeping left-to-right,
  // so treat it as if we'd arrived by moving East from its (guaranteed background)
  // West neighbor - dir=2 (East), matching the dirs[] index below. Starting from
  // dir=0 searched the wrong neighbor order and could spiral into a degenerate
  // 2-3 point loop right at the start pixel whenever it was a single-pixel-wide
  // tip (e.g. the top of a circular blob), instead of following the real boundary.
  let dir = 2;
  const maxSteps = (maxX - minX + 3) * (maxY - minY + 3) * 2;
  let steps = 0;
  // Jacob's stopping criterion: remember the first boundary pixel reached from
  // start, and only stop once we're back at start about to take that exact same
  // step again - just re-touching the start pixel's coordinates isn't enough,
  // since a thin protrusion can touch it again mid-trace without having gone
  // all the way around the shape.
  let firstX = -1, firstY = -1;

  do {
    points.push([x, y]);
    // Find next boundary pixel
    let found = false;
    const searchStart = (dir + 5) % 8; // start searching from dir-3
    let nx = -1, ny = -1, nd = -1;
    for (let i = 0; i < 8; i++) {
      const d = (searchStart + i) % 8;
      const cx = x + dirs[d][0];
      const cy = y + dirs[d][1];
      if (getPixel(cx, cy) === 1) {
        nx = cx;
        ny = cy;
        nd = d;
        found = true;
        break;
      }
    }
    if (!found) break;

    if (firstX === -1) {
      firstX = nx;
      firstY = ny;
    } else if (x === startX && y === startY && nx === firstX && ny === firstY) {
      break;
    }

    x = nx;
    y = ny;
    dir = nd;
    steps++;
  } while (steps < maxSteps);

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
  /** Tear down and re-run the connect flow from scratch (same config). */
  retry: () => void;
} {
  const [service, setService] = useState<AnnotationDataService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cellposeAvailable, setCellposeAvailable] = useState(false);
  const [microSamAvailable, setMicroSamAvailable] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
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
        // workspace/alias; datasets always live in the fixed bioimage-io
        // collection workspace, never the connected (annotating) user's own
        // workspace, so this must NOT use server.config.workspace (that was
        // the bug: an annotator's own workspace differs from bioimage-io,
        // so a bare-alias URL resolved to an id that was never registered).
        const artifactId = toArtifactId(config.artifactId);
        console.log('[useHyphaService] Resolved artifact id:', artifactId);

        // Cellpose (cellpose4-runner) and micro-sam availability: probed at
        // connect time, but fired as non-blocking promises rather than
        // awaited. Neither probe gates anything `wrappedService`'s methods
        // actually need at call time — `resolveCellposeService` below and
        // the per-call `resolveMicroSamService` calls further down both
        // re-resolve a fresh handle on every invocation regardless of
        // whether this probe succeeded. Blocking `service`/`setLoading(false)`
        // on these was pure added latency; running them in parallel with
        // building `wrappedService` lets the index fetch and image load
        // start as soon as the single `connectToServer` round-trip above
        // completes.
        //
        // cellpose4-runner is stateless across replicas (its resident-model
        // cache is a performance optimization, not per-session state), so
        // unlike cellpose-finetuning there is nothing to pin — see
        // utils/cellpose4RunnerService.ts.
        resolveCellpose4RunnerService(server)
          .then(() => {
            console.log('[useHyphaService] cellpose4-runner reachable');
            if (!cancelled) setCellposeAvailable(true);
          })
          .catch((err) => {
            console.warn('[useHyphaService] cellpose4-runner not reachable:', err);
            if (!cancelled) setCellposeAvailable(false);
          });

        /** Resolve a fresh handle to the cellpose4-runner service per call.
         *  Hypha service handles expire after a few minutes of inactivity;
         *  the symptom is ``Method expired or not found`` on the next
         *  infer. Cheap to resolve (one websocket round-trip) so we
         *  re-resolve unconditionally instead of caching + retrying. */
        const resolveCellposeService = async () => resolveCellpose4RunnerService(server);

        // micro-sam (μSAM) service probe. Unlike cellpose-finetuning there
        // is nothing to pin (μSAM is stateless across replicas), so both
        // the probe and the per-call resolver just re-resolve a fresh
        // handle from the fully-qualified service id.
        resolveMicroSamService(server)
          .then(() => {
            console.log('[useHyphaService] micro-sam reachable');
            if (!cancelled) setMicroSamAvailable(true);
          })
          .catch((err) => {
            console.warn('[useHyphaService] micro-sam not reachable:', err);
            if (!cancelled) setMicroSamAvailable(false);
          });

        const wrappedService: AnnotationDataService = {
          getDatasetIndex: async () => withRetry(() => brokerGetDatasetIndex(server, artifactId)),
          getImageUrl: async (imageStem: string) =>
            withRetry(() => brokerGetImageUrl(server, artifactId, imageStem)),
          getMyAnnotationUrl: async (imageStem: string) =>
            withRetry(() => brokerGetMyAnnotationUrl(server, artifactId, config.label, imageStem)),
          getSaveUrls: async (imageStem: string) =>
            withRetry(() => brokerGetSaveUrls(server, artifactId, config.label, imageStem)),
          getEmbeddingUrls: async (imageStem: string) =>
            withRetry(() => brokerGetEmbeddingUrls(server, artifactId, imageStem, MICRO_SAM_MODEL_TYPE)),
          runCellpose: async (imageUrl: string, width: number, height: number, params?: CellposeParams) => {
            const cellposeService = await resolveCellposeService();
            const p = params || {};
            console.log('[useHyphaService] Running cellpose4-runner inference with params:', p);

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

            // cellpose4-runner always targets the published 'idealistic-eagle'
            // model and takes a single `inputs` value (not a list). It has no
            // model/diameter/niter knobs.
            const inferArgs: Record<string, any> = {
              model_id: CELLPOSE4_RUNNER_MODEL_ID,
              inputs: inputArray,
              _rkwargs: true,
            };
            if (p.flow_threshold != null) inferArgs.flow_threshold = p.flow_threshold;
            if (p.cellprob_threshold != null) inferArgs.cellprob_threshold = p.cellprob_threshold;

            // infer() returns a request_id immediately; poll until the job
            // completes.
            const requestId = await cellposeService.infer(inferArgs);
            console.log('[useHyphaService] cellpose4-runner request submitted:', requestId);
            const result = await pollCellpose4Infer(cellposeService, requestId);

            const maskResult = result?.labels;
            if (!maskResult || maskResult._rtype !== 'ndarray') {
              console.warn('[useHyphaService] No labels ndarray in cellpose4-runner result:', result);
              return [];
            }

            const { maskData, w, h } = decodeLabelMask(maskResult);
            console.log('[useHyphaService] Cellpose mask ndarray: dtype=%s, [%d, %d]', maskResult._rdtype, h, w);
            // maskDataToPolygons handles min-area filtering and rescaling back
            // to display-space coordinates.
            const polygons = maskDataToPolygons(maskData, w, h, width, height, p.min_mask_area ?? 0);
            console.log('[useHyphaService] Converted mask to', polygons.length, 'polygons (scale %dx%d → %dx%d)', scaledW, scaledH, width, height);
            return polygons;
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
            console.log('[useHyphaService] Running cellpose4-runner flows-only inference:', p);

            const { chw, scaledW, scaledH } = await getImagePixelsCHW(imageUrl, width, height);
            const inputArray = {
              _rtype: 'ndarray',
              _rvalue: chw,
              _rshape: [3, scaledH, scaledW],
              _rdtype: 'uint8',
            };

            const inferArgs: Record<string, any> = {
              model_id: CELLPOSE4_RUNNER_MODEL_ID,
              inputs: inputArray,
              return_flows: true,
              _rkwargs: true,
            };

            const requestId = await cellposeService.infer(inferArgs);
            const result = await pollCellpose4Infer(cellposeService, requestId);

            // return_flows=True collapses the 2 flow components + cell
            // probability into a single 3-channel ndarray, member "flows".
            const flows = result?.flows;
            if (!flows || flows._rtype !== 'ndarray') {
              throw new Error(
                'cellpose4-runner did not return a flows payload (expected result.flows).',
              );
            }

            let buffer = flows._rvalue;
            let shape = flows._rshape as number[];
            if (buffer instanceof Uint8Array) {
              buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            }
            if (flows._rdtype !== 'float32') {
              console.warn(`[useHyphaService] flows dtype is ${flows._rdtype}, converting`);
            }
            const data = new Float32Array(buffer);

            // cellpose4-runner returns a leading batch axis, e.g. (1, 3, H, W)
            // instead of the bare (3, H, W) this guard used to require, which
            // made it throw on every real response and always fall back to
            // the all-server masks path.
            while (shape.length > 3 && shape[0] === 1) {
              shape = shape.slice(1);
            }
            if (shape.length !== 3 || shape[0] !== 3) {
              throw new Error(`flows shape ${JSON.stringify(shape)} not (3, H, W)`);
            }
            const outH = shape[1];
            const outW = shape[2];
            const plane = outH * outW;

            // First two channels are the flow components (dy, dx); the third
            // is the cell-probability plane. Slicing keeps the existing
            // CellposeFlowsResult shape the client-side Pyodide mask-gen
            // (public/cellpose_mask_gen.py) already consumes.
            const dP = data.subarray(0, 2 * plane);
            const cellprob = data.subarray(2 * plane, 3 * plane);

            console.log(
              '[useHyphaService] Got flows: dP (2,%d,%d) cellprob (%d,%d), %d KB',
              outH, outW, outH, outW,
              Math.round(data.byteLength / 1024),
            );

            return {
              dP,
              cellprob,
              scaledH: outH,
              scaledW: outW,
              displayW: width,
              displayH: height,
            };
          },
          requestAccess: async (role: 'annotator' | 'manager' = 'annotator') =>
            withRetry(() => brokerRequestAccess(server, artifactId, role)),
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
  }, [config?.artifactId, config?.label, retryNonce]);

  const retry = () => setRetryNonce((n) => n + 1);

  return { service, loading, error, cellposeAvailable, microSamAvailable, retry };
}
