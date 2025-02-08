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

export interface ArtifactInfo {
  id: string;
  type?: string;
  workspace: string;
  parent_id?: string;
  alias?: string;
  manifest: {
    name: string;
    description: string;
    icon?: string;
    id_emoji?: string;
    tags?: string[];
    badges?: Badge[];
    covers?: string[];
    type?: string[];
    documentation?: string;
    authors?: Author[];
    cite?: Citation[];
    links?: {
      url: string;
      icon?: string;
      label: string;
    }[];
    git_repo?: string;
    license?: string;
  };
  staging?: any[];
  download_count: number;
  view_count: number;
  file_count: number;
  created_at: number;
  created_by?: string;
  last_modified: number;
  versions?: Array<{
    version: string;
    comment: string;
    created_at: number;
  }>;
  config?: {
    permissions?: Record<string, string>;
    download_weights?: Record<string, number>;
    [key: string]: any;
  };
  name?: string; // From manifest
  description?: string; // From manifest
  _id?: string; // Internal ID
} 