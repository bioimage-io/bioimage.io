/** Canonical RDF spec filename for new models (BioImage.IO spec >= 0.5). */
export const BIOIMAGEIO_YAML = 'bioimageio.yaml';
/** Legacy RDF spec filename; still supported for reading. */
export const RDF_YAML = 'rdf.yaml';

/** Returns true when a bare filename (not a path) is either RDF spec filename. */
export function isRdfFileName(name: string): boolean {
  return name === BIOIMAGEIO_YAML || name === RDF_YAML;
}

/**
 * Returns true when a file path ends with either RDF spec filename.
 * Handles both bare names ('bioimageio.yaml') and paths ('model/bioimageio.yaml').
 */
export function endsWithRdfFileName(path: string): boolean {
  return path.endsWith(BIOIMAGEIO_YAML) || path.endsWith(RDF_YAML);
}

/**
 * Detects which RDF filename an artifact uses.
 * Prefers bioimageio.yaml; falls back to rdf.yaml; defaults to bioimageio.yaml for new models.
 */
export function detectRdfFileName(files: Array<{ path: string; name?: string }>): string {
  if (files.some(f => endsWithRdfFileName(f.path) && (f.name ?? f.path.split('/').pop()) === BIOIMAGEIO_YAML)) {
    return BIOIMAGEIO_YAML;
  }
  if (files.some(f => endsWithRdfFileName(f.path) && (f.name ?? f.path.split('/').pop()) === RDF_YAML)) {
    return RDF_YAML;
  }
  return BIOIMAGEIO_YAML;
}

/**
 * Finds the RDF spec file from a list of files.
 * Prefers bioimageio.yaml over rdf.yaml when both are present.
 */
export function findRdfFile<T extends { path: string; name?: string }>(files: T[]): T | undefined {
  return (
    files.find(f => endsWithRdfFileName(f.path) && (f.name ?? f.path.split('/').pop()) === BIOIMAGEIO_YAML) ??
    files.find(f => endsWithRdfFileName(f.path) && (f.name ?? f.path.split('/').pop()) === RDF_YAML)
  );
}
