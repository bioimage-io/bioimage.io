import { useCallback, useRef, useState } from 'react';

interface ExecuteOutput {
  type: 'stdout' | 'stderr' | 'result' | 'error' | 'image' | 'html';
  content: string;
  short_content?: string;
}

type ExecuteCode = (
  code: string,
  callbacks?: { onOutput?: (out: ExecuteOutput) => void; onStatus?: (s: string) => void },
) => Promise<void>;

export interface MaskGenParams {
  niter?: number;
  cellprob_threshold?: number;
  flow_threshold?: number;
  min_size?: number;
  max_size_fraction?: number;
}

export interface MaskGenResult {
  /** Flat uint16 label image, length = scaledH * scaledW. */
  data: Uint16Array;
  scaledH: number;
  scaledW: number;
}

const PYTHON_BOOTSTRAP = `
import micropip
await micropip.install(['scipy'])
print('cellpose mask-gen deps ready')
`;

/**
 * Wrap the fetched ``cellpose_mask_gen.py`` source in a one-shot ``exec``
 * inside an ad-hoc ``cellpose_mask_gen`` module so the per-compute snippet
 * below can do ``from cellpose_mask_gen import compute_masks_np`` without
 * fighting Pyodide's module loader. ``executeCode(src)`` would otherwise
 * just dump the helpers into ``__main__``, which the import statement
 * can't reach.
 */
const buildModuleInstaller = (src: string): string => `
import sys, types
_mod = types.ModuleType('cellpose_mask_gen')
_src = ${JSON.stringify(src)}
exec(compile(_src, 'cellpose_mask_gen.py', 'exec'), _mod.__dict__)
sys.modules['cellpose_mask_gen'] = _mod
print('cellpose_mask_gen module ready')
`;

function bytesToBase64(buf: Uint8Array): string {
  // Avoid String.fromCharCode.apply blowing the stack on big buffers; chunk it.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(buf.subarray(i, i + CHUNK)) as unknown as number[],
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * React hook exposing the Pyodide-runnable port of cellpose.dynamics
 * .compute_masks (see public/cellpose_mask_gen.py). The hook owns the
 * one-shot bootstrap (install scipy, exec the module) and a single
 * `compute` call that base64-marshals the raw (dP, cellprob) buffers
 * across the kernel boundary and returns a flat uint16 label image
 * ready for the existing maskToPolygons converter.
 *
 * The hook is intentionally agnostic to *which* kernel is in use; pass
 * either the shared KernelContext executeCode or a per-page kernel's
 * executeCode. ``kernelReady`` gates the bootstrap.
 */
export function useCellposeMaskGen(
  executeCode: ExecuteCode | null,
  kernelReady: boolean,
) {
  const initializedRef = useRef(false);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const ensureLoaded = useCallback(async (): Promise<void> => {
    if (initializedRef.current) return;
    if (!kernelReady || !executeCode) {
      throw new Error('Python kernel is not ready');
    }
    if (initPromiseRef.current) return initPromiseRef.current;
    initPromiseRef.current = (async () => {
      setIsLoading(true);
      try {
        let stderr = '';
        await executeCode(PYTHON_BOOTSTRAP, {
          onOutput: (o) => {
            if (o.type === 'error' || o.type === 'stderr') stderr += o.content;
          },
        });
        // Fetch and execute the mask-gen module.
        const url = `${process.env.PUBLIC_URL || ''}/cellpose_mask_gen.py`;
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`failed to load ${url}: ${resp.status}`);
        }
        const src = await resp.text();
        // Install as a real module (see buildModuleInstaller).
        await executeCode(buildModuleInstaller(src), {
          onOutput: (o) => {
            if (o.type === 'error' || o.type === 'stderr') stderr += o.content;
          },
        });
        if (stderr) {
          console.warn('[useCellposeMaskGen] bootstrap stderr:', stderr.slice(0, 400));
        }
        initializedRef.current = true;
      } catch (err) {
        initPromiseRef.current = null;
        throw err;
      } finally {
        setIsLoading(false);
      }
    })();
    return initPromiseRef.current;
  }, [executeCode, kernelReady]);

  /**
   * Run the ported compute_masks against the cached (dP, cellprob).
   *
   * @param dP  Flat Float32 buffer of length ``2 * scaledH * scaledW`` in
   *            row-major order: dy[H*W] then dx[H*W].
   * @param cellprob  Flat Float32 buffer of length ``scaledH * scaledW``.
   * @param scaledH  Height of the network output.
   * @param scaledW  Width of the network output.
   * @param params  Subset of cellpose mask-gen params.
   */
  const compute = useCallback(
    async (
      dP: Float32Array,
      cellprob: Float32Array,
      scaledH: number,
      scaledW: number,
      params: MaskGenParams = {},
    ): Promise<MaskGenResult> => {
      await ensureLoaded();
      if (!executeCode) throw new Error('Python kernel is not ready');

      // Validate buffer sizes before round-tripping bytes the kernel.
      if (dP.length !== 2 * scaledH * scaledW) {
        throw new Error(
          `dP length ${dP.length} does not match expected 2*${scaledH}*${scaledW}=${2 * scaledH * scaledW}`,
        );
      }
      if (cellprob.length !== scaledH * scaledW) {
        throw new Error(
          `cellprob length ${cellprob.length} does not match expected ${scaledH}*${scaledW}=${scaledH * scaledW}`,
        );
      }

      const dPB64 = bytesToBase64(new Uint8Array(dP.buffer, dP.byteOffset, dP.byteLength));
      const cpB64 = bytesToBase64(
        new Uint8Array(cellprob.buffer, cellprob.byteOffset, cellprob.byteLength),
      );

      const niter = params.niter ?? 200;
      const cellprobThreshold = params.cellprob_threshold ?? 0.0;
      const flowThreshold = params.flow_threshold ?? 0.0;
      const minSize = params.min_size ?? 15;
      const maxSizeFraction = params.max_size_fraction ?? 0.4;

      const code = `
import base64
import numpy as np
from cellpose_mask_gen import compute_masks_np
dP = np.frombuffer(base64.b64decode("${dPB64}"), dtype=np.float32).reshape(2, ${scaledH}, ${scaledW})
cellprob = np.frombuffer(base64.b64decode("${cpB64}"), dtype=np.float32).reshape(${scaledH}, ${scaledW})
mask = compute_masks_np(
    dP, cellprob,
    niter=${niter},
    cellprob_threshold=${cellprobThreshold},
    flow_threshold=${flowThreshold},
    min_size=${minSize},
    max_size_fraction=${maxSizeFraction},
)
out = mask.astype(np.uint16, copy=False).tobytes()
print("__MASK_B64_START__")
print(base64.b64encode(out).decode("ascii"))
print("__MASK_B64_END__")
`;
      let stdout = '';
      let errMsg = '';
      await executeCode(code, {
        onOutput: (o) => {
          if (o.type === 'stdout') stdout += o.content;
          else if (o.type === 'error') errMsg += o.content;
          else if (o.type === 'stderr') errMsg += o.content;
        },
      });
      if (errMsg) {
        throw new Error(errMsg.trim() || 'compute_masks_np failed');
      }
      const m = stdout.match(/__MASK_B64_START__\s*([A-Za-z0-9+/=\s]*?)\s*__MASK_B64_END__/);
      if (!m) {
        throw new Error('No mask payload in kernel output');
      }
      const b64 = m[1].replace(/\s/g, '');
      const raw = base64ToBytes(b64);
      const expected = scaledH * scaledW * 2;
      if (raw.byteLength !== expected) {
        throw new Error(
          `Unexpected mask byte length: got ${raw.byteLength}, want ${expected}`,
        );
      }
      // raw is a fresh Uint8Array — its underlying buffer is appropriately aligned for Uint16.
      return {
        data: new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2),
        scaledH,
        scaledW,
      };
    },
    [ensureLoaded, executeCode],
  );

  return { ensureLoaded, compute, isLoading };
}
