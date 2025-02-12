import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import SearchBar from './SearchBar';
import ResourceCard from './ResourceCard';
import PartnerScroll from './PartnerScroll';
import { Grid } from '@mui/material';
import TagSelection from './TagSelection';

interface ResourceGridProps {
  type?: 'model' | 'application' | 'notebook' | 'dataset';
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export const Pagination = ({ currentPage, totalPages, onPageChange }: PaginationProps) => {
  return (
    <div className="flex justify-center items-center gap-2 mt-6">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1 rounded bg-gray-100 disabled:opacity-50"
      >
        Previous
      </button>
      
      {/* Page numbers */}
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        const pageNum = i + 1;
        return (
          <button
            key={pageNum}
            onClick={() => onPageChange(pageNum)}
            className={`px-3 py-1 rounded ${
              currentPage === pageNum ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}
          >
            {pageNum}
          </button>
        );
      })}
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-1 rounded bg-gray-100 disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
};

// Add this overlay spinner component
const LoadingOverlay = () => (
  <div className="fixed inset-0 bg-white/50 flex items-center justify-center z-50">
    <div className="bg-white/90 rounded-lg p-6 shadow-lg flex flex-col items-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
      <div className="text-xl font-semibold text-gray-700">Loading resources...</div>
    </div>
  </div>
);

export const ResourceGrid: React.FC<ResourceGridProps> = ({ type }) => {
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const location = useLocation();
  const { 
    resources,
    resourceType,
    setResourceType,
    fetchResources,
    totalItems,
    itemsPerPage
  } = useHyphaStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const getCurrentType = useCallback(() => {
    const path = location.pathname.split('/')[1];
    // Convert plural path to singular type
    const typeMap: { [key: string]: string } = {
      'models': 'model',
      'datasets': 'dataset',
      'applications': 'application',
      'notebooks': 'notebook'
    };
    return typeMap[path] || null;
  }, [location.pathname]);

  useEffect(() => {
    // Update resource type in store when path changes
    const currentType = getCurrentType();
    setResourceType(currentType);
    // Reset to first page when resource type changes
    setCurrentPage(1);
  }, [getCurrentType, setResourceType]);

  useEffect(() => {
    const loadResources = async () => {
      try {
        setLoading(true);
        await fetchResources(currentPage, serverSearchQuery, {
          tags: selectedTags
        });
      } finally {
        setLoading(false);
      }
    };

    loadResources();
  }, [location.pathname, currentPage, resourceType, serverSearchQuery, selectedTags, fetchResources]);

  useEffect(() => {
    getCurrentType();
  }, [getCurrentType]);

  // Add debounced server search
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerSearchQuery(searchQuery);
      setCurrentPage(1);
    }, 500); // 500ms delay before triggering server search

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Remove client-side filtering since server handles it
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  const handlePartnerClick = useCallback((partnerId: string) => {
    setSearchQuery(partnerId);
    setCurrentPage(1);
  }, []);

  const handleTagSelect = (tag: string) => {
    setSelectedTags(prev => {
      return [tag];
    });
    setSearchQuery(tag);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <div className="container mx-auto px-4 sm:px-4 md:px-4 lg:px-4">
      {/* Show loading overlay when loading */}
      {loading && <LoadingOverlay />}
      
      <div className="community-partners mb-4">
        <div className="partner-logos">
          <PartnerScroll onPartnerClick={handlePartnerClick} />
        </div>
      </div>
      <div className="relative mb-8">
        <div 
          className="absolute right-10 -bottom-6 w-64 h-64 bg-contain bg-no-repeat bg-right-bottom opacity-20 pointer-events-none" 
          style={{ 
            backgroundImage: 'url(/img/zoo-background.svg)'
          }} 
        />
        <div className="max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchBar 
                value={searchQuery}
                onSearchChange={handleSearchChange}
                onSearchConfirm={() => {}}
              />
            </div>
            <div className="flex-none">
              <TagSelection 
                onTagSelect={handleTagSelect}
                selectedTags={selectedTags}
              />
            </div>
          </div>
        </div>
      </div>

      <Grid container spacing={2} sx={{ padding: { xs: 0.5, sm: 1, md: 2 } }}>
        {resources.map((resource) => (
          <Grid 
            item 
            key={resource.id} 
            xs={12}
            sm={6} 
            md={4} 
            lg={3} 
            sx={{
              minWidth: { xs: 'auto', sm: 280 },
              maxWidth: { xs: '100%', sm: 320 },
              margin: '0 auto'
            }}
          >
            <ResourceCard resource={resource} />
          </Grid>
        ))}
      </Grid>
      
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
};

export default ResourceGrid; 