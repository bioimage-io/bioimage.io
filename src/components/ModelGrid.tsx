import React from 'react';
import ModelCard from './ModelCard';

const SAMPLE_MODELS = [
  {
    id: 1,
    title: 'StarDist',
    description: 'Star-convex object detection for 2D and 3D images',
    author: 'Uwe Schmidt',
    downloads: '10.2k',
    likes: 245,
    tags: ['segmentation', '2D', '3D'],
  },
  {
    id: 2,
    title: 'CellPose',
    description: 'A generalist algorithm for cellular segmentation',
    author: 'Carsen Stringer',
    downloads: '8.5k',
    likes: 189,
    tags: ['segmentation', 'cells'],
  },
  // Add more sample models as needed
];

const ModelGrid = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {SAMPLE_MODELS.map((model) => (
        <ModelCard key={model.id} model={model} />
      ))}
    </div>
  );
};

export default ModelGrid; 