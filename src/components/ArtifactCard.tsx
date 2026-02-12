import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card, CardMedia, CardContent, IconButton, Button, Tooltip, Box, Typography, Stack, Chip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';

import { resolveHyphaUrl } from '../utils/urlHelpers';
import { ArtifactInfo, TestReport } from '../types/artifact';
import { PreviewDialog } from './PreviewDialog';
import { useHyphaStore } from '../store/hyphaStore';
import { useBookmarks } from '../hooks/useBookmarks';

interface ResourceCardProps {
  artifact: ArtifactInfo;
}

export const ArtifactCard: React.FC<ResourceCardProps> = ({ artifact }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const covers = artifact.manifest.covers || [];
  const navigate = useNavigate();
  const [showCopied, setShowCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const { setSelectedResource, user, isLoggedIn, artifactManager } = useHyphaStore();
  const { isBookmarked, toggleBookmark } = useBookmarks(artifactManager);

  // Check if user has edit permissions
  useEffect(() => {
    const checkEditPermissions = async () => {
      if (!isLoggedIn || !user || !artifactManager) {
        setCanEdit(false);
        return;
      }

      try {
        const collection = await artifactManager.read({
          artifact_id: 'bioimage-io/bioimage.io',
          _rkwargs: true
        });

        if (user && collection.config?.permissions) {
          const userPermission = collection.config.permissions[user.id];
          // Check if user has write permissions (rw, rw+, or *)
          const hasWritePermission = userPermission === 'rw' || userPermission === 'rw+' || userPermission === '*';
          // Also check if user has admin role
          const isAdmin = user.roles?.includes('admin');
          
          setCanEdit(hasWritePermission || isAdmin);
        } else {
          // Check if user has admin role even if not in permissions
          setCanEdit(user.roles?.includes('admin') || false);
        }
      } catch (error) {
        console.error('Error checking edit permissions:', error);
        setCanEdit(false);
      }
    };

    checkEditPermissions();
  }, [isLoggedIn, user, artifactManager]);

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
      navigate(`/artifacts/${id}`);
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

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/edit/${encodeURIComponent(artifact.id)}`);
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoggedIn) {
      alert('Please login to bookmark artifacts');
      return;
    }
    if (!artifactManager) {
      alert('Please wait for the system to initialize');
      return;
    }
    try {
      await toggleBookmark({
        id: artifact.id,
        name: artifact.manifest.name,
        description: artifact.manifest.description,
        covers: artifact.manifest.covers,
        icon: artifact.manifest.icon
      });
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      alert('Failed to toggle bookmark. Please try again.');
    }
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
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(229, 231, 235, 0.8)',
        borderRadius: '16px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.3s ease',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          borderColor: 'rgba(59, 130, 246, 0.3)',
          boxShadow: '0 8px 25px rgba(0, 0, 0, 0.1)',
          transform: 'translateY(-4px)',
          '& .preview-button': {
            opacity: 1,
          },
          '& .edit-button': {
            opacity: 1,
          },
          '& .bookmark-button': {
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
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '12px',
          opacity: 0,
          transition: 'all 0.3s ease',
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: 'rgba(59, 130, 246, 0.3)',
            transform: 'scale(1.05)',
          }
        }}
      >
        <VisibilityIcon fontSize="small" sx={{ color: 'rgba(107, 114, 128, 1)' }} />
      </IconButton>

      {canEdit && (
        <IconButton
          className="edit-button"
          onClick={handleEdit}
          sx={{
            position: 'absolute',
            top: 8,
            left: 56, // Position next to preview button
            zIndex: 1,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.5)',
            borderRadius: '12px',
            opacity: 0,
            transition: 'all 0.3s ease',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              borderColor: 'rgba(34, 197, 94, 0.3)',
              transform: 'scale(1.05)',
            }
          }}
        >
          <EditIcon fontSize="small" sx={{ color: 'rgba(34, 197, 94, 1)' }} />
        </IconButton>
      )}

      {isLoggedIn && artifactManager && (
        <Tooltip title={isBookmarked(artifact.id) ? "Remove bookmark" : "Bookmark"} placement="top">
          <IconButton
            className="bookmark-button"
            onClick={handleBookmark}
            sx={{
              position: 'absolute',
              top: 8,
              left: canEdit ? 104 : 56, // Position next to edit button if it exists, otherwise next to preview
              zIndex: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '12px',
              opacity: 0,
              transition: 'all 0.3s ease',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                borderColor: 'rgba(251, 191, 36, 0.3)',
                transform: 'scale(1.05)',
              }
            }}
          >
            {isBookmarked(artifact.id) ? (
              <StarIcon fontSize="small" sx={{ color: 'rgba(251, 191, 36, 1)' }} />
            ) : (
              <StarBorderIcon fontSize="small" sx={{ color: 'rgba(107, 114, 128, 1)' }} />
            )}
          </IconButton>
        </Tooltip>
      )}

      <PreviewDialog 
        open={previewOpen}
        artifact={artifact}
        onClose={handlePreviewClose}
      />

      <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}> {/* 16:9 aspect ratio container */}
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
              transition: 'transform 0.3s ease',
              '&:hover': {
                transform: 'scale(1.02)',
              }
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
              backgroundColor: 'rgba(249, 250, 251, 0.8)',
              backdropFilter: 'blur(4px)',
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
              <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full" />
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
                <div className="w-6 h-6 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full" />
              )}
            </div>
            <h3 className="text-base font-medium text-gray-900 break-words flex-grow truncate max-w-[calc(100%-2rem)]">
              {artifact.manifest.name}
            </h3>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500">
            <div className="flex items-center gap-1 bg-white/70 backdrop-blur-sm rounded-lg py-1 border border-white/50">
              <span className="font-medium">ID:</span>
              <code className="font-mono bg-gray-100/80 text-gray-800 px-2 py-1 rounded-md border border-gray-200/60 text-xs">
                {artifact.id.split('/').pop()}
              </code>
              <Tooltip title="Copy ID" placement="top">
                <IconButton
                  onClick={handleCopyId}
                  size="small"
                  className="ml-1 text-gray-400 hover:text-blue-600"
                  sx={{ 
                    padding: '2px',
                    borderRadius: '8px',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    }
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              {showCopied && (
                <span className="text-green-600 ml-1 font-medium">Copied!</span>
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
                className="px-2.5 py-1 bg-gray-50/80 text-gray-500 text-xs rounded-full border border-gray-100/60 transition-all duration-300 hover:bg-gray-100/80 hover:text-gray-600"
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
                className="px-2 py-0.5 bg-gradient-to-r from-blue-50/80 to-blue-100/80 backdrop-blur-sm text-blue-600 text-xs rounded-lg border border-blue-200/50 flex items-center gap-1 hover:from-blue-100/90 hover:to-blue-200/90 hover:border-blue-300/60 transition-all duration-300"
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
          transition: 'all 0.3s ease',
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
          borderRadius: '12px',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          color: 'white',
          fontWeight: 500,
          '&:hover': {
            background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
            borderColor: 'rgba(59, 130, 246, 0.4)',
            transform: 'translateY(0) scale(1.05)',
          },
        }}
      >
        Download
      </Button>
    </Card>
  );
};

export default ArtifactCard; 