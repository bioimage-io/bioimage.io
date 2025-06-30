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
    test_reports?: TestReport[];
    links?: {
      url: string;
      icon?: string;
      label: string;
    }[];
    git_repo?: string;
    license?: string;
    uploader: Uploader;
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