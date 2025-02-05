export interface ResourceManifest {
  name: string;
  description?: string;
  documentation?: string;
  tags?: string[];
  icon?: string;
  links?: ResourceLink[];
  // Add other manifest fields as needed
}

export interface ResourceLink {
  icon: string;
  label: string;
  url: string;
}

export interface Resource {
  id: string;
  manifest: ResourceManifest;
  download_count: number;
  view_count: number;
  last_modified: number;
  
  // Add other resource fields as needed
} 