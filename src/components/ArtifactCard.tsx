import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card, CardMedia, CardContent, IconButton, Button, Tooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';

import { resolveHyphaUrl } from '../utils/urlHelpers';
import { ArtifactInfo } from '../types/artifact';
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
          artifact_id: 'ri-scale/ai-model-hub',
          _rkwargs: true
        });

        if (user && collection.config?.permissions) {
          const userPermission = collection.config.permissions[user.id];
          const hasWritePermission = userPermission === 'rw' || userPermission === 'rw+' || userPermission === '*';
          const isAdmin = user.roles?.includes('admin');
          setCanEdit(hasWritePermission || isAdmin);
        } else {
          setCanEdit(user.roles?.includes('admin') || false);
        }
      } catch (error) {
        console.error('Error checking edit permissions:', error);
        setCanEdit(false);
      }
    };

    checkEditPermissions();
  }, [isLoggedIn, user, artifactManager]);

  const handleClick = (e: React.MouseEvent) => {
    const id = artifact.id.split('/').pop();
    navigate(`/artifacts/${id}`);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const id = artifact.id.split('/').pop();
    window.open(`https://hypha.aicell.io/ri-scale/artifacts/${id}/create-zip-file`, '_blank');
  };

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const getCurrentCoverUrl = () => {
    if (covers.length === 0) return '';
    return resolveHyphaUrl(covers[currentImageIndex], artifact.id);
  };

  return (
    <Card 
      onClick={handleClick}
      className="group"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb', // gray-200
        borderRadius: '8px',
        boxShadow: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.2s ease',
        '&:hover': {
          borderColor: '#f39200', // ri-orange
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          transform: 'translateY(-2px)',
          '& .action-button': {
            opacity: 1,
            transform: 'translateY(0)',
          },
        }
      }}
    >
      <div className="absolute top-2 left-2 z-10 flex gap-1">
        <IconButton
          className="action-button"
          onClick={handlePreviewOpen}
          size="small"
          sx={{
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #e5e7eb',
            opacity: 0,
            transform: 'translateY(-5px)',
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: '#f39200',
              color: 'white',
              borderColor: '#f39200',
            }
          }}
        >
          <VisibilityIcon fontSize="small" />
        </IconButton>

        {canEdit && (
          <IconButton
            className="action-button"
            onClick={handleEdit}
            size="small"
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              border: '1px solid #e5e7eb',
              opacity: 0,
              transform: 'translateY(-5px)',
              transition: 'all 0.2s ease',
              transitionDelay: '50ms',
              '&:hover': {
                backgroundColor: '#f39200',
                color: 'white',
                borderColor: '#f39200',
              }
            }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        )}

        {isLoggedIn && artifactManager && (
            <IconButton
              className="action-button"
              onClick={handleBookmark}
              size="small"
              sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid #e5e7eb',
                opacity: 0,
                transform: 'translateY(-5px)',
                transition: 'all 0.2s ease',
                transitionDelay: '100ms',
                 color: isBookmarked(artifact.id) ? '#f39200' : 'inherit',
                '&:hover': {
                  backgroundColor: '#f39200',
                  color: 'white',
                  borderColor: '#f39200',
                }
              }}
            >
              {isBookmarked(artifact.id) ? (
                <StarIcon fontSize="small"  />
              ) : (
                <StarBorderIcon fontSize="small" />
              )}
            </IconButton>
        )}
      </div>

      <PreviewDialog 
        open={previewOpen}
        artifact={artifact}
        onClose={handlePreviewClose}
      />

      <div style={{ position: 'relative', paddingTop: '56.25%', borderBottom: '1px solid #f3f4f6', overflow: 'hidden' }}>
        {covers.length > 0 ? (
          <CardMedia
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
              backgroundColor: '#f9fafb', // gray-50
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
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center text-gray-300">
                <VisibilityIcon />
              </div>
            )}
          </div>
        )}
      </div>
      
      <CardContent sx={{ flexGrow: 1, p: 2 }}>
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
                <div className="w-6 h-6 bg-gray-100 rounded-full" />
              )}
            </div>
            <h3 className="text-base font-bold text-ri-black break-words flex-grow truncate">
              {artifact.manifest.name}
            </h3>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500">
             <code className="font-mono bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                {artifact.id.split('/').pop()}
             </code>
             <Tooltip title="Copy ID" placement="top">
                <IconButton
                  onClick={handleCopyId}
                  size="small"
                  className="ml-1"
                  sx={{ 
                    padding: '2px', 
                    color: '#9ca3af',
                    '&:hover': { color: '#f39200' }
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              {showCopied && (
                <span className="text-green-600 ml-1 font-medium text-[10px]">Copied!</span>
              )}
          </div>
        </div>
        
        <p className="text-sm text-gray-600 my-4 line-clamp-3 leading-relaxed">
          {artifact.manifest.description}
        </p>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {artifact.manifest.tags?.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded border border-gray-200"
              >
                {tag}
              </span>
            ))}
             {artifact.manifest.tags && artifact.manifest.tags.length > 3 && (
                <span className="px-2 py-0.5 text-gray-400 text-xs text-[10px]">+{artifact.manifest.tags.length - 3}</span>
             )}
          </div>
          
           {artifact.manifest.badges && artifact.manifest.badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100 mt-2">
                {artifact.manifest.badges.map((badge) => (
                  <a
                    key={badge.url}
                    href={badge.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="px-1.5 py-0.5 bg-white text-gray-500 text-[10px] rounded border border-gray-200 flex items-center gap-1 hover:border-ri-orange hover:text-ri-orange transition-colors"
                  >
                    {badge.icon && <img src={badge.icon} alt="" className="h-3" />}
                    {badge.label}
                  </a>
                ))}
              </div>
            )}
        </div>
      </CardContent>

      <Button
        className="action-button"
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
          transition: 'all 0.2s ease',
          backgroundColor: '#f39200',
          color: 'white',
          boxShadow: 'none',
          '&:hover': {
            backgroundColor: '#d98200',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          },
        }}
      >
        Download
      </Button>
    </Card>
  );
};

export default ArtifactCard;