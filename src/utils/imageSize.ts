// Round-31 (colab-rework-plan.md, 2026-08-18): the deployed segmentation
// backend (cellpose4-runner) has a 256x256 input minimum. Since main commit
// 4e84090 the client upsamples undersized images to that floor so they still
// work, just with reduced quality. This module is the single place the
// 256px threshold and its user-facing copy are defined, so the annotate view
// and the upload/mount flows agree on both.

export const SMALL_IMAGE_DIM_THRESHOLD = 256;

export const SMALL_IMAGE_WARNING_TEXT = 'Below 256 px. AI segmentation quality may be reduced.';

export function isSmallImageDims(width: number, height: number): boolean {
  return width > 0 && height > 0 && (width < SMALL_IMAGE_DIM_THRESHOLD || height < SMALL_IMAGE_DIM_THRESHOLD);
}

/**
 * Decode a picked file's pixel dimensions entirely client-side, for the
 * upload/mount-time warning scan. Returns null instead of throwing when the
 * browser can't decode the format (e.g. TIFF has no native codec in Chrome
 * or Firefox), since this check is advisory and must not block the upload
 * or mount flow it runs alongside.
 */
export async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}
