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
  authors?: Author[];
  createdAt?: number;
  lastModified?: number;
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
  authors = [],
  createdAt,
  lastModified
}) => {
  const handleClick = (e: React.MouseEvent, callback?: () => void) => {
    e.stopPropagation();
    if (callback) callback();
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200 h-[280px] flex flex-col">
      <div className="p-4 flex flex-col flex-1">
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
            {tags.map((tag, index) => (
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
          <div className="flex space-x-2">
            <button
              onClick={(e) => handleClick(e, onEdit)}
              className="p-2 text-gray-600 hover:text-blue-600 rounded-full hover:bg-blue-50"
              title="Edit"
            >
              <PencilIcon className="w-5 h-5" />
            </button>
            {isStaged && onDelete && (
              <button
                onClick={(e) => handleClick(e, onDelete)}
                className="p-2 text-gray-600 hover:text-red-600 rounded-full hover:bg-red-50"
                title="Delete"
              >
                <TrashIcon className="w-5 h-5" />
              </button>
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