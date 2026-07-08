import { HYPHA_SERVER_URL } from '../config/hypha';

/**
 * bioimageio.spec 0.5.11 changed several fields from plain string paths to
 * FileDescr objects ({source, sha256}). Callers pass whatever the resource
 * manifest carries — for older resources that's still a string, for newer
 * ones it's a descriptor. Normalize both shapes here so every consumer
 * (covers, documentation, etc.) can pass the raw value straight through.
 */
type FileLike = string | { source?: string } | null | undefined;

const extractPath = (input: FileLike): string => {
  if (!input) return '';
  if (typeof input === 'string') return input;
  return typeof input.source === 'string' ? input.source : '';
};

/**
 * Resolves a relative URL to a full Hypha artifact URL
 * @param path - The relative path to resolve (string OR FileDescr with a `source` field)
 * @param resourceId - The resource ID
 * @returns The full resolved URL
 */
/**
 * Inserts ".thumbnail" before the file extension: "cover.png" → "cover.thumbnail.png".
 * Returns the original path unchanged if it has no extension or is an external URL.
 */
export const resolveCoverThumbnailUrl = (path: FileLike, resourceId: string): string => {
  const source = extractPath(path);
  if (!source) return '';
  if (source.startsWith('http://') || source.startsWith('https://')) return source;
  const lastDot = source.lastIndexOf('.');
  const thumbnailPath = lastDot === -1
    ? source
    : `${source.substring(0, lastDot)}.thumbnail${source.substring(lastDot)}`;
  const id = resourceId.split('/').pop();
  return `${HYPHA_SERVER_URL}/bioimage-io/artifacts/${id}/files/${thumbnailPath}`;
};

export const resolveHyphaUrl = (path: FileLike, resourceId: string, use_proxy: boolean = false): string => {
  const source = extractPath(path);
  if (!source) return '';

  // If the source is already a full URL, return it as is
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return source;
  }

  // Extract the ID from the full artifact ID (removing any prefix like 'bioimage.io/')
  const id = resourceId.split('/').pop();

  // Construct the full URL
  if (use_proxy) {
    return `${HYPHA_SERVER_URL}/bioimage-io/artifacts/${id}/files/${source}?use_proxy=true`;
  } else {
    return `${HYPHA_SERVER_URL}/bioimage-io/artifacts/${id}/files/${source}`;
  }
};