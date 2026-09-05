import { HYPHA_SERVER_URL } from '../config/hypha';
import { FileRef } from '../types/artifact';

/**
 * bioimageio.spec 0.5.11 changed several fields from plain string paths to
 * FileDescr objects ({source, sha256}). Callers pass whatever the resource
 * manifest carries — for older resources that's still a string, for newer
 * ones it's a descriptor. Normalize both shapes here so every consumer
 * (covers, documentation, etc.) can pass the raw value straight through.
 */
type FileLike = FileRef | null | undefined;

/**
 * Returns the relative path a manifest field points at, for both shapes.
 * Use this instead of touching the field directly: rendering a FileDescr as a
 * React child throws ("objects are not valid as a React child"), and comparing
 * one to a filename silently never matches.
 */
export const extractFilePath = (input: FileLike): string => {
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

export const resolveHyphaUrl = (path: FileLike, resourceId: string, use_proxy: boolean = false): string => {
  const source = extractFilePath(path);
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

/**
 * Builds the URL for a model's test report from the dedicated test-report collection
 * (model-runner v1.13.2+). Reports live under bioimage-io/test-report-<modelId>/files/
 * published/ or staged/ depending on whether the artifact is in staging mode.
 *
 * @param artifactId - full artifact ID, e.g. 'bioimage-io/cheerful-panda'
 * @param staged     - true when the caller is viewing the staged version of the artifact
 */
export const resolveTestReportUrl = (artifactId: string, staged: boolean): string => {
  const modelId = artifactId.split('/').pop();
  const slot = staged ? 'staged' : 'published';
  return `${HYPHA_SERVER_URL}/bioimage-io/artifacts/test-report-${modelId}/files/${slot}/test_report.json?use_proxy=true`;
};
/** The workspace every artifact on this site lives in. */
const ARTIFACT_WORKSPACE = 'bioimage-io';

/**
 * Turn the `:id` / `:version` params of the detail routes into the
 * workspace-qualified id `fetchResource` expects.
 *
 * Two URL shapes have to resolve to the same artifact: the short one the app
 * links to itself (`#/resources/affable-shark`) and the workspace-qualified one
 * that Hypha, the Edit page and the API docs hand out
 * (`#/resources/bioimage-io%2Faffable-shark`). React Router matches on the raw
 * path and only decodes `%2F` when handing over the param, so in the qualified
 * form `:id` already carries the workspace. Prefixing it a second time produced
 * `bioimage-io/bioimage-io/<alias>`, which addressed no artifact at all.
 *
 * An *unencoded* slash is a different story: the router splits on it while
 * matching, so `#/artifacts/bioimage-io/affable-shark` lands the workspace in
 * `:id` and the alias in `:version`. That shape is folded back together here
 * too, since it is what a human types by hand.
 */
export const resolveArtifactRouteId = (
  id: string,
  version?: string,
): { artifactId: string; version?: string } => {
  if (id === ARTIFACT_WORKSPACE && version) {
    return { artifactId: `${ARTIFACT_WORKSPACE}/${version}`, version: undefined };
  }
  return {
    artifactId: id.includes('/') ? id : `${ARTIFACT_WORKSPACE}/${id}`,
    version,
  };
};
