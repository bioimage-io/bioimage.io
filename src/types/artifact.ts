export interface Badge {
  url: string;
  icon?: string;
  label: string;
}

export interface Author {
  name: string;
  orcid?: string;
  affiliation?: string;
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
}

export interface DetailedTestReport {
  name: string;
  source_name: string;
  id: string;
  type: string;
  format_version: string;
  status: 'passed' | 'failed';
  details: TestDetail[];
  env: string[][];
  conda_list: any;
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
    covers?: string[];
    documentation?: string;
    authors?: Author[];
    cite?: Citation[];
    test_reports?: TestReports | TestReport[];
    links?: {
      url: string;
      icon?: string;
      label: string;
    }[];
    git_repo?: string;
    license?: string;
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
    [key: string]: any;
  };
  name?: string; // From manifest
  description?: string; // From manifest
  _id?: string; // Internal ID
}

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
  cite?: Citation[];
  documentation?: Documentation;
  links?: Link[];
  config?: Config;
  weights?: Weight[];
  status?: string;
  uploader: Uploader;
} 