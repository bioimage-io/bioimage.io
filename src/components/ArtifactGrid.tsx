import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import SearchBar from './SearchBar';
import ArtifactCard from './ArtifactCard';
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
  <div className="fixed inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center z-50">
    <div className="bg-white/80 backdrop-blur-lg rounded-xl p-8 flex flex-col items-center shadow-lg border border-white/50">
      <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-300 border-t-blue-600 mb-4"></div>
      <div className="text-lg font-medium text-gray-700">Loading resources...</div>
      <div className="text-sm text-gray-500 mt-1">Please wait while we fetch the latest data</div>
    </div>
  </div>
);

export const ArtifactGrid: React.FC<ResourceGridProps> = ({ type }) => {
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const location = useLocation();
  const navigate = useNavigate();
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
    // Update artifact type in store when path changes
    const currentType = getCurrentType();
    setResourceType(currentType);
    // Reset to first page when artifact type changes
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
    <div className="w-full">
      <div className="container mx-auto px-2 sm:px-4 md:px-4 lg:px-4">
        {/* Enhanced separator line with gradient and shadow */}
        <div className="relative w-full mb-8 sm:mb-12">
          <div className="w-full h-px bg-gradient-to-r from-transparent via-blue-300/50 to-transparent"></div>
          <div className="absolute inset-0 w-full h-px bg-gradient-to-r from-transparent via-purple-200/30 to-transparent transform translate-y-0.5"></div>
          {/* Subtle shadow line */}
          <div className="absolute inset-0 w-full h-2 bg-gradient-to-b from-blue-50/20 to-transparent transform translate-y-1"></div>
        </div>
        
        {/* Show loading overlay when loading */}
        {loading && <LoadingOverlay />}
        
        <div className="community-partners mb-4">
          <div className="partner-logos">
            <PartnerScroll onPartnerClick={handlePartnerClick} />
          </div>
        </div>

        {/* Hero Slogan Section */}
        <div className="text-center px-2 sm:px-0">
         
           <p className="text-base sm:text-lg md:text-xl font-medium mb-2 bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
             Discover, explore, and deploy cutting-edge bioimage analysis models
           </p>

        </div>
        
        <div className="relative mb-6 sm:mb-8">
          <div 
            className="absolute right-2 sm:right-10 -bottom-6 w-32 h-32 sm:w-64 sm:h-64 bg-contain bg-no-repeat bg-right-bottom opacity-20 pointer-events-none" 
            style={{ 
              backgroundImage: 'url(/img/zoo-background.svg)'
            }} 
          />
          <div className="max-w-3xl mx-auto w-full px-2 sm:px-0">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                <SearchBar 
                  value={searchQuery}
                  onSearchChange={handleSearchChange}
                  onSearchConfirm={() => {}}
                />
              </div>
              <div className="flex-none self-center sm:self-auto">
                <TagSelection 
                  onTagSelect={handleTagSelect}
                  selectedTags={selectedTags}
                />
              </div>
            </div>
          </div>
        </div>

        {/* BioEngine Button - Only show for applications */}
        {resourceType === 'application' && (
          <div className="max-w-3xl mx-auto mb-6 sm:mb-8 px-2 sm:px-0">
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 rounded-2xl p-4 sm:p-6 shadow-sm hover:shadow-md transition-all duration-200">
              <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mr-4 shadow-md p-1">
                    <img src="/bioengine-icon.svg" alt="BioEngine" className="w-10 h-10" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-1">
                      Run BioImage Models with BioEngine
                    </h3>
                    <p className="text-sm text-gray-600">
                      Bring bioimage models locally, on-premise or in the cloud. We support laptops, workstations, HPC clusters, and cloud platforms.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/bioengine')}
                  className="w-full sm:w-auto sm:ml-2.5 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 shadow-md hover:shadow-lg transition-all duration-200 transform hover:scale-105 flex items-center justify-center"
                >
                  <span className="mr-2">Launch BioEngine</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        <Grid container spacing={2} sx={{ padding: { xs: 0.5, sm: 1, md: 2 } }}>
          {resources.map((artifact) => (
            <Grid 
              item 
              key={artifact.id} 
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
              <ArtifactCard artifact={artifact} />
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
    </div>
  );
};

export default ArtifactGrid; 