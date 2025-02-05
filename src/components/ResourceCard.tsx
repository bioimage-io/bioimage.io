import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Resource } from '../types';
import { Card, CardMedia, CardContent, IconButton, Button } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

interface ResourceCardProps {
  resource: Resource;
}

export const ResourceCard: React.FC<ResourceCardProps> = ({ resource }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const covers = resource.manifest.covers || [];
  const navigate = useNavigate();

  const nextImage = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    setCurrentImageIndex((prev) => (prev + 1) % covers.length);
  };

  const previousImage = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    setCurrentImageIndex((prev) => (prev - 1 + covers.length) % covers.length);
  };

  const handleClick = () => {
    const id = resource.id.split('/').pop();
    navigate(`/resources/${id}`);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click/navigation
    const id = resource.id.split('/').pop();
    window.open(`http://hypha.aicell.io/bioimage-io/artifacts/${id}/create-zip-file`, '_blank');
  };

  return (
    <Card 
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
        cursor: 'pointer',
        position: 'relative',
        '&:hover': {
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.12)',
          transform: 'translateY(-2px)',
          transition: 'all 0.2s ease-in-out',
          '& .download-button': {
            opacity: 1,
            transform: 'translateY(0)',
          },
        }
      }}
      onClick={handleClick}
    >
      <div style={{ position: 'relative', paddingTop: '56.25%' }}> {/* 16:9 aspect ratio container */}
        {covers.length > 0 ? (
          <CardMedia
            component="img"
            image={covers[currentImageIndex]}
            alt={resource.manifest.name}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderBottom: '1px solid rgba(0, 0, 0, 0.12)'
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f5f5f5',
              borderBottom: '1px solid rgba(0, 0, 0, 0.12)'
            }}
          >
            {resource.manifest.icon ? (
              <img
                src={resource.manifest.icon}
                alt={resource.manifest.name}
                style={{
                  width: '40%',
                  height: '40%',
                  objectFit: 'contain'
                }}
              />
            ) : resource.manifest.id_emoji ? (
              <span style={{ fontSize: '3rem' }}>{resource.manifest.id_emoji}</span>
            ) : (
              <div className="w-16 h-16 bg-gray-200 rounded-full" />
            )}
          </div>
        )}
      </div>
      <CardContent sx={{ flexGrow: 1, p: 2 }}>
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
      </CardContent>

      <Button
        className="download-button"
        onClick={handleDownload}
        startIcon={<DownloadIcon />}
        variant="contained"
        size="small"
        sx={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          opacity: 0,
          transform: 'translateY(10px)',
          transition: 'all 0.2s ease-in-out',
          backgroundColor: '#2563eb',
          color: 'white',
          '&:hover': {
            backgroundColor: '#1d4ed8',
          },
        }}
      >
        Download
      </Button>
    </Card>
  );
};

export default ResourceCard; 