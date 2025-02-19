import React from 'react';
import ResourceGrid from '../components/ResourceGrid';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../components/SearchBar';

const AnnotatePage: React.FC = () => {
  const navigate = useNavigate();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      navigate('/annotate/new', { state: { files } });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Combined Banner and Upload Section */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Left side - Text */}
            <div className="flex-1 text-white">
              <h1 className="text-3xl font-bold tracking-tight">
                Collaborative Annotation
              </h1>
              <p className="mt-2 text-lg text-blue-100">
                Create, share, and manage annotation projects efficiently
              </p>
            </div>
            
            {/* Right side - Upload Box */}
            <div className="flex-1 w-full">
              <div 
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="bg-white/10 backdrop-blur-sm border-2 border-white/20 rounded-lg p-6 text-center hover:bg-white/20 transition-colors cursor-pointer"
              >
                <div className="mx-auto w-12 h-12 text-white/80 mb-3">
                  <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-white mb-1">
                  Start New Project
                </h3>
                <p className="text-blue-100 text-sm mb-3">
                  Drop images or folders here
                </p>
                <button 
                  onClick={() => document.getElementById('file-upload')?.click()}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-blue-700 bg-white hover:bg-blue-50"
                >
                  Select Files
                </button>
                <input 
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      navigate('/annotate/new', { state: { files: e.target.files } });
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">
            Recent Annotation Projects
          </h2>
          <div className="w-72">
            <SearchBar 
              onSearchChange={() => {}} 
              onSearchConfirm={() => {}}
            />
          </div>
        </div>
        <ResourceGrid type="annotation" hidePartners />
      </div>
    </div>
  );
};

export default AnnotatePage; 