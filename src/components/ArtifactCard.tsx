import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card, CardMedia, CardContent, IconButton, Button, Tooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { resolveHyphaUrl } from '../utils/urlHelpers';
import { ArtifactInfo } from '../types/artifact';
import { PreviewDialog } from './PreviewDialog';
import { useHyphaStore } from '../store/hyphaStore';
interface ResourceCardProps {
  artifact: ArtifactInfo;
}

export const ArtifactCard: React.FC<ResourceCardProps> = ({ artifact }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const covers = artifact.manifest.covers || [];
  const navigate = useNavigate();
  const [showCopied, setShowCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { setSelectedResource } = useHyphaStore();
  const nextImage = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    setCurrentImageIndex((prev) => (prev + 1) % covers.length);
  };

  const previousImage = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    setCurrentImageIndex((prev) => (prev - 1 + covers.length) % covers.length);
  };

  const handleClick = (e: React.MouseEvent) => {
    // Only navigate if the click target is the card itself, not children
    // if (e.target === e.currentTarget) {
      const id = artifact.id.split('/').pop();
      navigate(`/resources/${id}`);
    // }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click/navigation
    const id = artifact.id.split('/').pop();
    window.open(`https://hypha.aicell.io/bioimage-io/artifacts/${id}/create-zip-file`, '_blank');
  };

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card navigation
    const id = artifact.id.split('/').pop() || '';
    navigator.clipboard.writeText(id);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handlePreviewOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedResource(artifact);
    setPreviewOpen(true);
  };

  const handlePreviewClose = () => {
    setPreviewOpen(false);
  };

  // Get the resolved cover URL for the current index
  const getCurrentCoverUrl = () => {
    if (covers.length === 0) return '';
    return resolveHyphaUrl(covers[currentImageIndex], artifact.id);
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
          '& .preview-button': {
            opacity: 1,
          },
          '& .download-button': {
            opacity: 1,
            transform: 'translateY(0)',
          },
        }
      }}
    >
      <IconButton
        className="preview-button"
        onClick={handlePreviewOpen}
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          opacity: 0,
          transition: 'opacity 0.2s ease-in-out',
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
          }
        }}
      >
        <VisibilityIcon fontSize="small" />
      </IconButton>

      <PreviewDialog 
        open={previewOpen}
        artifact={artifact}
        onClose={handlePreviewClose}
      />

      <div style={{ position: 'relative', paddingTop: '56.25%' }}> {/* 16:9 aspect ratio container */}
        {covers.length > 0 ? (
          <CardMedia
            onClick={handleClick}
            component="img"
            image={getCurrentCoverUrl()}
            alt={artifact.manifest.name}
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
            {artifact.manifest.icon ? (
              <img
                src={artifact.manifest.icon}
                alt={artifact.manifest.name}
                style={{
                  width: '40%',
                  height: '40%',
                  objectFit: 'contain'
                }}
              />
            ) : artifact.manifest.id_emoji ? (
              <span style={{ fontSize: '3rem' }}>{artifact.manifest.id_emoji}</span>
            ) : (
              <div className="w-16 h-16 bg-gray-200 rounded-full" />
            )}
          </div>
        )}
      </div>
      <CardContent sx={{ flexGrow: 1, p: 2 }} onClick={handleClick}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-6">
              {artifact.manifest.icon ? (
                <img
                  src={artifact.manifest.icon}
                  alt={artifact.manifest.name}
                  className="w-6 h-6 object-contain"
                />
              ) : artifact.manifest.id_emoji ? (
                <span className="text-xl">{artifact.manifest.id_emoji}</span>
              ) : (
                <div className="w-6 h-6 bg-gray-200 rounded-full" />
              )}
            </div>
            <h3 className="text-base font-medium text-gray-900 break-words flex-grow truncate max-w-[calc(100%-2rem)]">
              {artifact.manifest.name}
            </h3>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500">
            <div className="flex items-center gap-1 bg-gray-50 rounded-md px-2 py-1">
              <span className="font-medium">ID:</span>
              <code className="font-mono">{artifact.id.split('/').pop()}</code>
              <Tooltip title="Copy ID" placement="top">
                <IconButton
                  onClick={handleCopyId}
                  size="small"
                  className="ml-1 text-gray-400 hover:text-gray-600"
                  sx={{ padding: '2px' }}
                >
                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              {showCopied && (
                <span className="text-green-600 ml-1">Copied!</span>
              )}
            </div>
          </div>
        </div>
        
        <p className="text-sm text-gray-600 my-4 line-clamp-2">
          {artifact.manifest.description}
        </p>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {artifact.manifest.tags?.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs rounded-full border border-gray-100"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {artifact.manifest.badges?.map((badge) => (
              <a
                key={badge.url}
                href={badge.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
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

export default ArtifactCard; 