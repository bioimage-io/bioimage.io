export interface Resource {
  id: string;
  manifest: {
    name: string;
    description: string;
    icon?: string;
    id_emoji?: string;
    tags?: string[];
    badges?: string[];
    type?: string;
  };
} 