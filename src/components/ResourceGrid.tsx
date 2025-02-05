import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import { Resource } from '../types';
import SearchBar from './SearchBar';
import ResourceCard from './ResourceCard';
import PartnerScroll from './PartnerScroll';

interface ResourceGridProps {
  type?: 'model' | 'application' | 'notebook' | 'dataset';
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const Pagination = ({ currentPage, totalPages, onPageChange }: PaginationProps) => {
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

const ResourceGrid: React.FC<ResourceGridProps> = ({ type }) => {
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
        await fetchResources(currentPage, serverSearchQuery);
      } finally {
        setLoading(false);
      }
    };

    loadResources();
  }, [location.pathname, currentPage, resourceType, serverSearchQuery, fetchResources]);

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

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <div className="container mx-auto px-4">
      <div className="community-partners">
        <div className="partner-logos">
          <PartnerScroll />
        </div>
      </div>
      <SearchBar 
        onSearchChange={handleSearchChange}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
        {loading && (
          <div className="col-span-full flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        )}
        
        {/* Remove filteredResources and use resources directly since they're already filtered by server */}
        {resources.map((resource) => (
          <ResourceCard key={resource.id} resource={resource} />
        ))}
        
      </div>
      
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