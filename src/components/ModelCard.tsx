import React from 'react';

interface ModelCardProps {
  model: {
    title: string;
    description: string;
    author: string;
    downloads: string;
    likes: number;
    tags: string[];
  };
}

const ModelCard = ({ model }: ModelCardProps) => {
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <div className="p-6">
        <h3 className="text-xl font-semibold text-gray-900">{model.title}</h3>
        <p className="mt-2 text-gray-600">{model.description}</p>
        <div className="mt-4">
          <p className="text-sm text-gray-500">By {model.author}</p>
        </div>
        <div className="mt-4 flex items-center space-x-4">
          <span className="text-sm text-gray-500">⬇️ {model.downloads}</span>
          <span className="text-sm text-gray-500">❤️ {model.likes}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {model.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModelCard; 