export interface Resource {
  id: string;
  manifest: {
    name: string;
    description: string;
    icon?: string;
    id_emoji?: string;
    tags?: string[];
    badges?: Badge[];
    covers?: string[];
    type?: string;
  };
}

export interface Badge {
  url: string;
  icon?: string;
  label: string;
} 