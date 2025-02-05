export interface ResourceManifest {
  name: string;
  icon?: string;
  tags?: string[];
  description?: string;
  links?: {
    url: string;
    icon?: string;
    label: string;
  }[];
}

export interface Resource {
  manifest: ResourceManifest;
  download_count: number;
  view_count: number;
  last_modified: number;
} 