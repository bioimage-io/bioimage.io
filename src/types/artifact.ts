export interface Badge {
  url: string;
  icon?: string;
  label: string;
}

export interface Author {
  name: string;
  orcid?: string;
  affiliation?: string;
  email?: string;
  github_user?: string;
}

export interface Maintainer {
  name: string;
  orcid?: string;
  affiliation?: string;
  email?: string;
  github_user?: string;
}

export interface Citation {
  text: string;
  doi?: string;
}

export interface TestReport {
  name: string;
  status: string;
  runtime: string;
}

export interface TestReports {
  created_at: string;
  execution_time: number;
  reports: TestReport[];
}

export interface TestError {
  loc: string[];
  msg: string;
  type: string;
  with_traceback: boolean;
  traceback_md: string;
  traceback_html: string;
}

export interface TestDetail {
  name: string;
  status: 'passed' | 'failed';
  loc: string[];
  errors: TestError[];
  warnings: any[];
  context: any;
  recommended_env: any;
  conda_compare: string | null;
  saved_conda_compare?: string | null;
}

export interface DetailedTestReport {
  name: string;
  source_name: string;
  id: string;
  type: string;
  format_version: string;
  status: 'passed' | 'failed' | 'valid-format';
  metadata_completeness?: number;
  /** Whether the model runs in the standard (default) environment. */
  inference_check?: { status: 'passed' | 'failed'; error: string | null };
  details: TestDetail[];
  env: string[][];
  conda_list: any;
  saved_conda_list?: string;
}

interface Version {
  version: string;
  comment: string;
  created_at: number;
}
interface Uploader {
  email: string;
  name: string | null;
}

export interface ArtifactInfo {
  id: string;
  type?: string;
  workspace: string;
  parent_id?: string;
  alias?: string;
  manifest: {
    type: string;
    name: string;
    description: string;
    icon?: string;
    id_emoji?: string | null;
    tags?: string[];
    badges?: Badge[];
    covers?: FileRef[];
    documentation?: FileRef;
    authors?: Author[];
    maintainers?: Maintainer[];
    cite?: Citation[];
    links?: {
      url: string;
      icon?: string;
      label: string;
    }[];
    git_repo?: string;
    license?: FileRef;
    uploader: Uploader;
    status?: string;
  };
  staging?: any[];
  download_count: number;
  view_count: number;
  file_count: number;
  created_at: number;
  created_by?: string;
  last_modified: number;
  versions: Version[];
  current_version: string;
  config?: {
    permissions?: Record<string, string>;
    download_weights?: Record<string, number>;
    /** Emails granted `rw+` by the authors/maintainers permission sync, so the next run can revoke ones no longer listed. */
    contributor_permission_keys?: string[];
    [key: string]: any;
  };
  name?: string; // From manifest
  description?: string; // From manifest
  _id?: string; // Internal ID
}

/**
 * bioimageio.spec 0.5.11 turned several path-valued RDF fields into a union:
 * either the plain relative path they always were, or a FileDescr object
 * carrying the path plus its checksum. `license` is the same union with one
 * extra member, a bare SPDX identifier, which is a string but NOT a path.
 * Anything reading these fields must normalize first (see utils/urlHelpers).
 */
export interface FileDescr {
  source: string;
  sha256?: string;
}

export type FileRef = string | FileDescr;

export interface Documentation {
  url?: string;
  text?: string;
}

export interface Link {
  url: string;
  text: string;
}

export interface Config {
  [key: string]: any;
}

export interface Weight {
  source: string;
  sha256?: string;
  size?: number;
}

export interface Manifest {
  type: string;
  name: string;
  description: string;
  icon?: string;
  id_emoji?: string | null;
  tags?: string[];
  badges?: Badge[];
  covers?: string[];
  authors?: Author[];
  maintainers?: Maintainer[];
  cite?: Citation[];
  documentation?: Documentation;
  links?: Link[];
  config?: Config;
  weights?: Weight[];
  status?: string;
  uploader: Uploader;
  file_sha256?: { [key: string]: string };
} 