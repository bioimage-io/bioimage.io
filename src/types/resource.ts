export interface Author {
  name: string;
  orcid?: string;
  affiliation?: string;
}

export interface Citation {
  text: string;
  doi?: string;
}

export interface ResourceManifest {
  name: string;
  icon?: string;
  tags?: string[];
  description?: string;
  id_emoji?: string;
  version?: string;
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
  type?: string[];
}

export interface Resource {
  id: string;
  manifest: ResourceManifest;
  download_count: number;
  view_count: number;
  last_modified?: number;
} 