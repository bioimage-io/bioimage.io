import React, { useState, useRef, useEffect } from 'react';
import TuneIcon from '@mui/icons-material/Tune';

interface TagSelectionProps {
  onTagSelect: (tag: string) => void;
  selectedTags?: string[];
}

export const tagCategories = {
  modality: [
    "electron-microscopy",
    "cryo-electron-microscopy",
    "fluorescence-light-microscopy",
    "transmission-light-microscopy",
    "super-resolution-microscopy",
    "x-ray-microscopy",
    "force-microscopy",
    "high-content-imaging",
    "whole-slide-imaging",
  ],
  dims: ["2d", "3d", "2d-t", "3d-t"],
  content: [
    "cells",
    "nuclei",
    "extracellular-vesicles",
    "tissue",
    "plant",
    "mitochondria",
    "vasculature",
    "cell-membrane",
    "brain",
    "whole-organism"
  ],
  framework: ["tensorflow", "pytorch", "tensorflow.js"],
  software: ["ilastik", "imagej", "fiji", "imjoy", "deepimagej", "napari"],
  method: ["stardist", "cellpose", "yolo", "care", "n2v", "denoiseg"],
  network: ["unet", "densenet", "resnet", "inception", "shufflenet"],
  task: [
    "semantic-segmentation",
    "instance-segmentation",
    "object-detection",
    "image-classification",
    "denoising",
    "image-restoration",
    "image-reconstruction",
    "in-silico-labeling"
  ]
};

const TagSelection: React.FC<TagSelectionProps> = ({ onTagSelect, selectedTags = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTagClick = (tag: string) => {
    onTagSelect(`${tag}`);
    setIsOpen(false);
  };

  const formatCategoryName = (category: string) => {
    return category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="h-12 w-12 rounded-lg bg-white/80 backdrop-blur-sm border border-white/50 hover:border-blue-200/60 hover:bg-white/90 transition-all duration-300 shadow-sm hover:shadow-md group flex items-center justify-center"
        aria-label="Filter by tags"
        title="Filter by tags"
      >
        <TuneIcon className="text-gray-600 group-hover:text-blue-600 transition-colors duration-300" fontSize="small" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={() => setIsOpen(false)} />
          
          {/* Dropdown */}
          <div
            ref={dropdownRef}
            className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[80vw] max-w-[500px] bg-white/95 backdrop-blur-lg rounded-lg border border-white/50 shadow-xl shadow-blue-200/10 z-50 max-h-[80vh] overflow-hidden"
          >
            {/* Header */}
            <div className="sticky top-0 bg-white/90 backdrop-blur-lg border-b border-blue-100/50 p-4 z-10">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Filter by Tags
                </h3>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-blue-600 transition-colors duration-300 hover:bg-blue-50/50 rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-80px)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(tagCategories).map(([category, tags]) => (
                  <div key={category} className="mb-4 last:mb-0">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                      {formatCategoryName(category)}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => {
                        const isSelected = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => handleTagClick(tag)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-300 border backdrop-blur-sm ${
                              isSelected
                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-500/20 shadow-md hover:from-blue-700 hover:to-blue-800 hover:shadow-lg'
                                : 'bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 hover:border-blue-200/60 hover:text-blue-600 hover:shadow-sm'
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TagSelection; 