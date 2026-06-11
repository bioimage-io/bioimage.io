import { useEffect, useRef, useState } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { resolvePinnedCellposeService } from '../../../utils/cellposeServicePin';

export interface AnnotationServiceConfig {
  serverUrl: string;
  imageProviderId: string;
  label?: string;
}

export interface SaveUrls {
  png_url: string;
  geojson_url: string;
  image_stem: string;
}

export interface CellposeMask {
  label: number;
  coordinates: number[][][]; // polygon rings
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

export interface ImageResult {
  url: string;
  name: string;
  cellpose_model?: string;
  existing_geojson_url?: string | null;
  round?: number;
}

export interface CurrentRoundResult {
  current_round: number;
  max_existing_round: number;
}

export interface ImageInfo {
  name: string;
  stem: string;
  source: 'local' | 'remote';
  /** Whether the *current annotator* has saved both PNG + GeoJSON for this image. */
  is_annotated: boolean;
  /** Whether *any* annotator has saved this image (used for global progress). */
  annotated_by_any?: boolean;
}

export interface ImageNotFoundResult {
  status: 'not_found';
  message: string;
}

export interface AnnotationDataService {
  /** The annotator id resolved at connect time (Hypha workspace user id, or
   *  a localStorage anon uuid for booth visitors). Surfaced for diagnostic
   *  banners and as the key for round-state storage. */
  userId: string;
  /** Highest existing round number for this user when the connection was
   *  established. Returned by the colab service's get_current_round. The
   *  React component holds the live current round in its own state and
   *  passes it to every call below. */
  initialRound: number;
  getImage: (round: number) => Promise<ImageResult | AllAnnotatedResult | NoImagesResult>;
  getImageByStem: (stem: string, round: number) => Promise<ImageResult | ImageNotFoundResult>;
  listImages: (round: number) => Promise<ImageInfo[]>;
  getSaveUrls: (imageName: string, round: number) => Promise<SaveUrls>;
  runCellpose: (imageUrl: string, width: number, height: number, params?: CellposeParams) => Promise<CellposeMask[]>;
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

/** Extract image pixel data as a Uint8Array in CHW RGB format (3, H, W) for cellpose */
/** Max pixel dimension sent to Cellpose-SAM. Larger images are downsampled to this size.
 *  256 gives ~30-60s inference on HPA fluorescence images with 10-20 cells detected.
 *  512 gives 5-15 min for the same images (too slow for interactive use). */
const CELLPOSE_MAX_DIM = 256;

function getImagePixelsCHW(
  imageUrl: string,
  width: number,
  height: number,
): Promise<{ chw: Uint8Array; scaledW: number; scaledH: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Downsample if either dimension exceeds CELLPOSE_MAX_DIM
      const scale = Math.min(1, CELLPOSE_MAX_DIM / Math.max(width, height));
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
} {
  const [service, setService] = useState<AnnotationDataService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cellposeAvailable, setCellposeAvailable] = useState(false);
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
        // connect into their own Hypha workspace (ws-user-<id>). The
        // workspace shape is what useHyphaService uses to resolve a stable
        // per-annotator user_id below. Anonymous booth visitors fall back
        // to a localStorage anon uuid.
        let storedToken: string | undefined;
        try {
          const t = window.localStorage.getItem('token');
          const expiryRaw = window.localStorage.getItem('tokenExpiry');
          const stillValid = !expiryRaw || new Date(expiryRaw).getTime() > Date.now();
          if (t && stillValid) storedToken = t;
        } catch {
          // localStorage may be unavailable in private modes; carry on anonymous.
        }
        const connectCfg: any = { server_url: config.serverUrl };
        if (storedToken) connectCfg.token = storedToken;
        const server = await hyphaWebsocketClient.connectToServer(connectCfg);
        if (cancelled) {
          await server.disconnect();
          return;
        }
        serverRef.current = server;
        console.log('[useHyphaService] Connected to workspace:', server.config.workspace);

        // Derive a stable per-annotator id. Logged-in users get their Hypha
        // user id (workspace shape ws-user-<id>). Anonymous booth visitors
        // get a localStorage-backed uuid that persists across reloads on
        // the same browser, so their per-user mask folder stays consistent.
        const workspaceName: string = server.config?.workspace || '';
        let resolvedUserId = '';
        if (workspaceName.startsWith('ws-user-')) {
          resolvedUserId = workspaceName.substring('ws-user-'.length);
        } else {
          try {
            const stored = window.localStorage.getItem('bioimage_annot_anon_id');
            if (stored) {
              resolvedUserId = stored;
            } else {
              const fresh = 'anon-' + Math.random().toString(36).slice(2, 12);
              window.localStorage.setItem('bioimage_annot_anon_id', fresh);
              resolvedUserId = fresh;
            }
          } catch {
            resolvedUserId = 'anon-' + Math.random().toString(36).slice(2, 12);
          }
        }
        console.log('[useHyphaService] Resolved annotator user_id:', resolvedUserId);

        const dataService = await server.getService(config.imageProviderId);
        if (cancelled) return;
        console.log('[useHyphaService] Got data service:', dataService);

        // Ask the data service which round this user is on. New users get 1;
        // returning users pick up where they left off.
        let resolvedInitialRound = 1;
        try {
          const cr = await dataService.get_current_round({
            user_id: resolvedUserId,
            _rkwargs: true,
          });
          const n = cr && (cr.current_round as number);
          if (typeof n === 'number' && n > 0) {
            resolvedInitialRound = n;
          }
          console.log('[useHyphaService] Initial round:', resolvedInitialRound,
            '(max existing:', cr?.max_existing_round, ')');
        } catch (err) {
          console.warn('[useHyphaService] get_current_round failed, defaulting to 1:', err);
        }

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

        const wrappedService: AnnotationDataService = {
          userId: resolvedUserId,
          initialRound: resolvedInitialRound,
          getImage: async (round: number) => {
            const result = await dataService.get_image({
              user_id: resolvedUserId,
              round_n: round,
              _rkwargs: true,
            });
            // Service returns a dict with status field for terminal states
            if (result && typeof result === 'object') {
              const status = (result as any).status;
              if (status === 'all_annotated') {
                console.log('[useHyphaService] All images annotated:', result);
                return result as AllAnnotatedResult;
              }
              if (status === 'no_images') {
                console.log('[useHyphaService] No images available:', result);
                return result as NoImagesResult;
              }
            }
            // Older versions or different implementations might still return a string
            if (typeof result === 'string') {
              console.log('[useHyphaService] Image URL:', result);
              const name = result.split('/').pop()?.split('?')[0] || 'image.png';
              return { url: result, name } as ImageResult;
            }
            console.log('[useHyphaService] Image Info:', result);
            return result as ImageResult;
          },
          getImageByStem: async (stem: string, round: number) => {
            console.log('[useHyphaService] Getting image by stem:', stem, 'label:', config.label, 'user:', resolvedUserId, 'round:', round);
            const result = await dataService.get_image_by_stem({
              image_stem: stem,
              label: config.label,
              user_id: resolvedUserId,
              round_n: round,
              _rkwargs: true,
            });
            if (result && typeof result === 'object' && (result as any).status === 'not_found') {
              console.warn('[useHyphaService] Image not found:', result);
              return result as ImageNotFoundResult;
            }
            return result as ImageResult;
          },
          listImages: async (round: number) => {
            const result = await dataService.list_images({
              user_id: resolvedUserId,
              round_n: round,
              _rkwargs: true,
            });
            return (result || []) as ImageInfo[];
          },
          getSaveUrls: async (imageName: string, round: number) => {
            console.log('[useHyphaService] Getting save URLs for:', imageName, 'user:', resolvedUserId, 'round:', round);
            const urls = await dataService.get_save_urls({
              image_name: imageName,
              label: config.label,
              user_id: resolvedUserId,
              round_n: round,
              _rkwargs: true,
            });
            return urls as SaveUrls;
          },
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
  }, [config?.serverUrl, config?.imageProviderId]);

  return { service, loading, error, cellposeAvailable };
}
