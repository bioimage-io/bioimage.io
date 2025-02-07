import React from 'react';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';

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
  status: 'staged' | 'published';
  authors?: Author[];
  createdAt?: number;
  lastModified?: number;
  artifactType?: string;
}

const AdminResourceCard: React.FC<AdminResourceCardProps> = ({
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
  artifactType
}) => {
  const handleClick = (e: React.MouseEvent, callback?: () => void) => {
    e.stopPropagation();
    if (callback) callback();
  };

  return (
    <div className={`relative bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200 h-[260px] flex flex-col ${
      isStaged ? 'bg-yellow-50' : ''
    }`}>
      <div className="absolute top-2 right-2 z-10">
        {status === 'staged' ? (
          <span className="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20">
            Staged
          </span>
        ) : status === 'published' && (
          <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-600/20">
            Published
          </span>
        )}
      </div>
      
      <div className="p-4">
        <div className="flex-none">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
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
          
          <div className="flex flex-wrap gap-2">
            {tags.slice(0, 5).map((tag, index) => (
              <span
                key={index}
                className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600"
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
            >
              <PencilIcon className="w-5 h-5" />
              <span className="ml-1">Edit</span>
            </button>
            {isStaged && onDelete && (
              <button
                onClick={(e) => handleClick(e, onDelete)}
                className="flex items-center p-2 text-gray-600 hover:text-red-600 rounded-lg hover:bg-red-50"
                title="Delete"
              >
                <TrashIcon className="w-5 h-5" />
                <span className="ml-1">Delete</span>
              </button>
            )}
            {artifactType && (
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                {artifactType}
              </span>
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

export default AdminResourceCard; 