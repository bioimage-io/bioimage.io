/**
 * Supported local image file extensions for dataset import.
 * Mirrors the `ImageFormat` enum in `public/colab_service.py` — keep in sync
 * if that enum ever changes.
 */
export const SUPPORTED_IMAGE_EXTENSIONS: string[] = [
  '.jpg',
  '.jpeg',
  '.png',
  '.tif',
  '.tiff',
];
