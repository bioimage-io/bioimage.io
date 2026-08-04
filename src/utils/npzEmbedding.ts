// Parse a micro-sam embedding `.npz` (produced by the μSAM service's
// `compute_embedding(embedding_upload_url=...)` path via `np.savez`) into the
// raw pieces the in-browser ONNX box decoder needs.
//
// A `.npz` is just a ZIP archive of `.npy` entries. `np.savez` stores them
// uncompressed (ZIP_STORED); JSZip handles both stored and deflated entries, so
// a future `savez_compressed` would still parse. Each `.npy` entry is a NumPy
// array with a small self-describing header.
//
// The stored bundle carries: `features` (1,256,64,64) float32, `input_size`
// (2,) int (SAM-resized h,w), `original_size` (2,) int (original H,W), and
// `model_type` (0-d str, ignored here since the client pins the model). It does
// NOT carry sam_scale or mask_threshold; the caller derives those
// (sam_scale = max(input_size)/max(original_size); mask_threshold = 0.0 for the
// *_lm models).

import JSZip from 'jszip';

/** One parsed `.npy` entry: the raw data section plus its declared shape/dtype. */
interface NpyArray {
  /** Raw little-endian data bytes (the array payload, header stripped). */
  data: Uint8Array;
  /** Declared array shape, e.g. [1, 256, 64, 64]. */
  shape: number[];
  /** NumPy dtype descriptor from the header, e.g. '<f4', '<i8'. */
  dtype: string;
}

/**
 * Parse a single `.npy` byte buffer into its data section + shape + dtype.
 *
 * `.npy` layout: 6-byte magic `\x93NUMPY`, 1-byte major, 1-byte minor, then the
 * header-length field (uint16 LE for v1.0, uint32 LE for v2.0+), then an ASCII
 * Python-dict header (`{'descr': ..., 'fortran_order': ..., 'shape': (...)}`)
 * padded to a 64-byte boundary, then the raw array data.
 *
 * @throws If the magic bytes are missing (not a `.npy` file).
 */
function parseNpy(bytes: Uint8Array): NpyArray {
  const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new Error('npzEmbedding: not a .npy file (bad magic)');
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6];
  let headerLen: number;
  let dataStart: number;
  if (major >= 2) {
    headerLen = view.getUint32(8, true);
    dataStart = 12 + headerLen;
  } else {
    headerLen = view.getUint16(8, true);
    dataStart = 10 + headerLen;
  }
  const headerBytes = bytes.subarray(dataStart - headerLen, dataStart);
  const header = new TextDecoder('ascii').decode(headerBytes);

  const descrMatch = header.match(/'descr'\s*:\s*'([^']*)'/);
  const dtype = descrMatch ? descrMatch[1] : '';

  const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]*)\)/);
  const shape = shapeMatch
    ? shapeMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => parseInt(s, 10))
    : [];

  const data = bytes.subarray(dataStart);
  return { data, shape, dtype };
}

/** Read a small integer `.npy` (e.g. shape (2,) `<i8`/`<i4`) into a number[]. */
function npyToInts(arr: NpyArray): number[] {
  const view = new DataView(arr.data.buffer, arr.data.byteOffset, arr.data.byteLength);
  const count = arr.shape.reduce((a, b) => a * b, 1);
  const out: number[] = [];
  // Integer bounds here (image dimensions) fit comfortably in a JS number, so
  // int64 low-word reads are safe. Match the itemsize to the declared dtype.
  const itemsize = arr.dtype.includes('8') ? 8 : arr.dtype.includes('2') ? 2 : 4;
  for (let i = 0; i < count; i++) {
    const off = i * itemsize;
    if (itemsize === 8) {
      out.push(Number(view.getBigInt64(off, true)));
    } else if (itemsize === 2) {
      out.push(view.getInt16(off, true));
    } else {
      out.push(view.getInt32(off, true));
    }
  }
  return out;
}

/** Parsed contents of a stored μSAM embedding `.npz`. */
export interface ParsedEmbeddingNpz {
  /** Raw little-endian float32 bytes of the encoder features (decoder-ready). */
  features: Uint8Array;
  /** Features array shape, e.g. [1, 256, 64, 64]. */
  featuresShape: number[];
  /** SAM-resized [h, w] the encoder ran at. */
  inputSize: number[];
  /** Original image [H, W] before the SAM resize. */
  originalSize: number[];
}

/**
 * Unzip a micro-sam embedding `.npz` and return the pieces the ONNX box decoder
 * consumes. `features` bytes pass through untouched (the decoder reinterprets
 * them as a `Float32Array` for the `image_embeddings` tensor).
 *
 * @param buf ArrayBuffer of the downloaded `.npz`.
 * @throws If any required entry is missing or malformed.
 */
export async function parseEmbeddingNpz(buf: ArrayBuffer): Promise<ParsedEmbeddingNpz> {
  const zip = await JSZip.loadAsync(buf);

  const read = async (name: string): Promise<NpyArray> => {
    const entry = zip.file(name) || zip.file(`${name}.npy`);
    if (!entry) {
      throw new Error(`npzEmbedding: missing ${name} in .npz`);
    }
    return parseNpy(await entry.async('uint8array'));
  };

  const featuresNpy = await read('features');
  const inputSizeNpy = await read('input_size');
  const originalSizeNpy = await read('original_size');

  return {
    features: featuresNpy.data,
    featuresShape: featuresNpy.shape,
    inputSize: npyToInts(inputSizeNpy),
    originalSize: npyToInts(originalSizeNpy),
  };
}
