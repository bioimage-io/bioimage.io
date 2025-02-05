import { Link } from 'react-router-dom';
import { Badge } from './Badge';

interface ResourceCardProps {
  id: string;
  manifest: {
    name: string;
    description: string;
    icon?: string;
    id_emoji?: string;
    badges?: string[];
    tags?: string[];
  };
}

export const ResourceCard = ({ id, manifest }: ResourceCardProps) => {
  return (
    <Link 
      to={`/?id=${encodeURIComponent(id)}`}
      className="block p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-3 mb-2">
        {manifest.icon ? (
          <img src={manifest.icon} alt="" className="w-8 h-8 object-contain" />
        ) : manifest.id_emoji ? (
          <span className="text-2xl">{manifest.id_emoji}</span>
        ) : null}
        <h3 className="font-medium text-lg">{manifest.name}</h3>
      </div>
      
      <p className="text-gray-600 mb-3 line-clamp-2">
        {manifest.description}
      </p>

      <div className="flex flex-wrap gap-2">
        {manifest.badges?.map((badge, i) => (
          <Badge key={i} text={badge} />
        ))}
        {manifest.tags?.slice(0, 3).map((tag, i) => (
          <Badge key={i} text={tag} variant="secondary" />
        ))}
      </div>
    </Link>
  );
}; 