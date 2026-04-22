import { useEffect, useRef, useState } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';

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
}

export interface AnnotationDataService {
  getImage: () => Promise<ImageResult | AllAnnotatedResult | NoImagesResult>;
  getSaveUrls: (imageName: string) => Promise<SaveUrls>;
  runCellpose: (imageUrl: string, width: number, height: number, params?: CellposeParams) => Promise<CellposeMask[]>;
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
} {
  const [service, setService] = useState<AnnotationDataService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const server = await hyphaWebsocketClient.connectToServer({
          server_url: config.serverUrl,
        });
        if (cancelled) {
          await server.disconnect();
          return;
        }
        serverRef.current = server;
        console.log('[useHyphaService] Connected to workspace:', server.config.workspace);

        const dataService = await server.getService(config.imageProviderId);
        if (cancelled) return;
        console.log('[useHyphaService] Got data service:', dataService);

        // Get cellpose service
        let cellposeService: any = null;
        try {
          cellposeService = await server.getService('bioimage-io/cellpose-finetuning');
          console.log('[useHyphaService] Got cellpose service');
        } catch (err) {
          console.warn('[useHyphaService] Cellpose service not available:', err);
        }

        const wrappedService: AnnotationDataService = {
          getImage: async () => {
            const result = await dataService.get_image();
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
          getSaveUrls: async (imageName: string) => {
            console.log('[useHyphaService] Getting save URLs for:', imageName);
            const urls = await dataService.get_save_urls(imageName);
            return urls as SaveUrls;
          },
          runCellpose: async (imageUrl: string, width: number, height: number, params?: CellposeParams) => {
            if (!cellposeService) {
              throw new Error('Cellpose service is not available');
            }
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
            if (p.diameter != null && p.diameter > 0) inferArgs.diameter = p.diameter;
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
              polygons = filterByArea(polygons, p.min_mask_area);
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
              polygons = filterByArea(polygons, p.min_mask_area);
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

  return { service, loading, error };
}
