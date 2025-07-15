import React from 'react';

interface StatusBadgeProps {
  status: string;
  size?: 'small' | 'medium' | 'large';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'medium' }) => {
  // Return null if status is empty
  if (!status) return null;

  const getStatusConfig = (status: string) => {
    const configs = {
      'request-review': { color: 'yellow', text: 'Request for Review' },
      'in-review': { color: 'blue', text: 'In Review' },
      'revision': { color: 'red', text: 'Needs Revision' },
      'accepted': { color: 'green', text: 'Accepted' },
      'draft': { color: 'gray', text: 'Draft' },
      'deletion-requested': { color: 'red', text: 'Deletion Requested' }
    } as const;
    
    return configs[status.toLowerCase() as keyof typeof configs] || configs.draft;
  };

  const config = getStatusConfig(status);
  const sizeClasses = {
    small: 'px-1.5 py-0.5 text-xs',
    medium: 'px-2.5 py-1 text-sm',
    large: 'px-3 py-1.5 text-base'
  };

  return (
    <span className={`inline-flex items-center rounded-full font-medium
      ${sizeClasses[size]}
      ${
        {
          yellow: 'bg-yellow-100 text-yellow-800',
          blue: 'bg-blue-100 text-blue-800', 
          red: 'bg-red-100 text-red-800',
          green: 'bg-green-100 text-green-800',
          gray: 'bg-gray-100 text-gray-800'
        }[config.color]
      }
    `}>
      {config.text}
    </span>
  );
};

export default StatusBadge; 