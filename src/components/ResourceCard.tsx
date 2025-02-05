import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Resource } from '../types';

interface ResourceCardProps {
  resource: Resource;
}

const ResourceCard: React.FC<ResourceCardProps> = ({ resource }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const covers = resource.manifest.covers || [];

  const nextImage = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    setCurrentImageIndex((prev) => (prev + 1) % covers.length);
  };

  const previousImage = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    setCurrentImageIndex((prev) => (prev - 1 + covers.length) % covers.length);
  };

  return (
    <Link
      to={`/?id=${encodeURIComponent(resource.id)}`}
      className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col h-full"
    >
      {/* Carousel Section */}
      {covers.length > 0 && (
        <div className="relative w-full pt-[56.25%]"> {/* 16:9 aspect ratio */}
          <div className="absolute top-0 left-0 w-full h-full">
            <img
              src={covers[currentImageIndex]}
              alt={`${resource.manifest.name} preview ${currentImageIndex + 1}`}
              className="w-full h-full object-cover rounded-t-lg"
            />
            {covers.length > 1 && (
              <>
                <button
                  onClick={previousImage}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
                >
                  ←
                </button>
                <button
                  onClick={nextImage}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
                >
                  →
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {covers.map((_, index) => (
                    <div
                      key={index}
                      className={`w-2 h-2 rounded-full ${
                        index === currentImageIndex ? 'bg-white' : 'bg-white/50'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Existing Card Content */}
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