import React, { useState } from 'react';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import StatusBadge from './StatusBadge';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Tooltip, IconButton, CircularProgress } from '@mui/material';

interface Author {
  name: string;
}

interface AdminResourceCardProps {
  title: string;
  description: string;
  tags: string[];
  image?: string;
  downloadUrl?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  isStaged?: boolean;
  status: 'staged' | 'published' | 'deletion-requested';
  authors?: Author[];
  createdAt?: number;
  lastModified?: number;
  artifactType?: string;
  isCollectionAdmin?: boolean;
  onRequestDeletion?: () => void;
  id: string;
  emoji?: string;
  isLoading?: boolean;
  deletionRequestLoading?: boolean;
}

const MyArtifactCard: React.FC<AdminResourceCardProps> = ({
  title,
  description,
  tags,
  image,
  downloadUrl,
  onEdit,
  onDelete,
  isStaged,
  status,
  authors = [],
  createdAt,
  lastModified,
  artifactType,
  isCollectionAdmin = false,
  onRequestDeletion,
  id,
  emoji,
  isLoading = false,
  deletionRequestLoading = false,
}) => {
  const [showCopied, setShowCopied] = useState(false);

  const handleClick = (e: React.MouseEvent, callback?: () => void) => {
    e.stopPropagation();
    if (callback) callback();
  };

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id.split('/').pop() || '');
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  return (
    <div className={`relative bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200 h-[300px] flex flex-col ${
      isStaged ? 'bg-yellow-50' : ''
    }`}>
      
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        
        {artifactType && (
          <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-800 ring-1 ring-inset ring-purple-600/20">
            {artifactType}
          </span>
        )}
        {isStaged ? (
          <span className="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20">
            Staged
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-600/20">
            Published
          </span>
        )}
        {status && <StatusBadge status={status} size="small" />}
        
      </div>
      
      <div className="p-4 mt-5">
        <div className="flex-none">
          <div className="flex items-center gap-2 mb-2">
            {emoji && <span className="text-xl">{emoji}</span>}
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
            <div className="flex items-center gap-1 bg-gray-50 rounded-md px-2 py-1">
              <span className="font-medium">ID:</span>
              <code className="font-mono">{id.split('/').pop()}</code>
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

          <p className="text-sm text-gray-600 mb-4 line-clamp-2">{description}</p>
        </div>
        
        <div className="flex-1">
          {authors.length > 0 && (
            <div className="mb-3 text-sm text-gray-600">
              By: {authors.map(author => author.name).join(', ')}
            </div>
          )}

          <div className="mb-3 text-xs text-gray-500">
            {createdAt && (
              <div>Created: {formatDistanceToNow(createdAt * 1000)} ago</div>
            )}
            {lastModified && (
              <div>Modified: {formatDistanceToNow(lastModified * 1000)} ago</div>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2 overflow-hidden h-6">
            {tags.slice(0, 5).map((tag, index) => (
              <span
                key={index}
                className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 whitespace-nowrap"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center mt-4 border-t pt-4 flex-none">
        
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => handleClick(e, onEdit)}
              className="flex items-center p-2 text-gray-600 hover:text-blue-600 rounded-lg hover:bg-blue-50"
              title="Edit"
              disabled={isLoading}
            >
              <PencilIcon className="w-5 h-5" />
              <span className="ml-1">Edit</span>
            </button>
            {isStaged && (
              <>
                {isCollectionAdmin && onDelete ? (
                  <button
                    onClick={(e) => handleClick(e, onDelete)}
                    className="flex items-center p-2 text-gray-600 hover:text-red-600 rounded-lg hover:bg-red-50"
                    title="Delete"
                    disabled={isLoading}
                  >
                    <TrashIcon className="w-5 h-5" />
                    <span className="ml-1">Delete</span>
                  </button>
                ) : onRequestDeletion && status !== 'deletion-requested' && (
                  <button
                    onClick={(e) => handleClick(e, onRequestDeletion)}
                    className="flex items-center p-2 text-gray-600 hover:text-red-600 rounded-lg hover:bg-red-50"
                    title="Request Deletion"
                    disabled={deletionRequestLoading}
                  >
                    {deletionRequestLoading ? (
                      <>
                        <CircularProgress size={20} className="mr-2" />
                        <span className="ml-1">Requesting...</span>
                      </>
                    ) : (
                      <>
                        <TrashIcon className="w-5 h-5" />
                        <span className="ml-1">Delete</span>
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
          
          {downloadUrl && (
            <a
              href={downloadUrl}
              onClick={(e) => e.stopPropagation()}
              className="text-sm text-blue-600 hover:text-blue-800"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyArtifactCard; 