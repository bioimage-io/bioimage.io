import React from 'react';
import { Link } from 'react-router-dom';
import { Resource } from '../types';

interface ResourceCardProps {
  resource: Resource;
}

const ResourceCard: React.FC<ResourceCardProps> = ({ resource }) => {
  return (
    <Link
      to={`/?id=${encodeURIComponent(resource.id)}`}
      className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col h-full"
    >
      <div className="p-4 flex flex-col h-full">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 w-8">
            {resource.manifest.icon ? (
              <img
                src={resource.manifest.icon}
                alt={resource.manifest.name}
                className="w-8 h-8 object-contain"
              />
            ) : resource.manifest.id_emoji ? (
              <span className="text-2xl">{resource.manifest.id_emoji}</span>
            ) : (
              <div className="w-8 h-8 bg-gray-200 rounded-full" />
            )}
          </div>
          <h3 className="text-base font-medium text-gray-900 break-words flex-grow truncate max-w-[calc(100%-2.5rem)]">
            {resource.manifest.name}
          </h3>
        </div>
        
        <p className="text-sm text-gray-600 mb-4 line-clamp-2 flex-grow">
          {resource.manifest.description}
        </p>

        <div className="space-y-2">
          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {resource.manifest.tags?.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs rounded-full border border-gray-100"
              >
                {tag}
              </span>
            ))}
          </div>
          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            {resource.manifest.badges?.map((badge) => (
              <a
                key={badge.url}
                href={badge.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-100 flex items-center gap-1 hover:bg-blue-100 transition-colors"
              >
                {badge.icon && <img src={badge.icon} alt="" className="h-4" />}
                {badge.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
};

export default ResourceCard; 