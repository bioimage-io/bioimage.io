import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import { Resource } from '../types';
import SearchBar from './SearchBar';
import ResourceCard from './ResourceCard';

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
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const location = useLocation();
  const { resourceType, setResourceType } = useHyphaStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  
  const ITEMS_PER_PAGE = 12;

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
  }, [getCurrentType, setResourceType]);

  useEffect(() => {
    const fetchResources = async () => {
      try {
        setLoading(true);
        const offset = (currentPage - 1) * ITEMS_PER_PAGE;
        
        // Construct the base URL
        let url = `https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?pagination=true&offset=${offset}&limit=${ITEMS_PER_PAGE}`;
        
        // Add type filter if resourceType is specified
        if (resourceType) {
          const filters = JSON.stringify({ type: resourceType });
          url += `&filters=${encodeURIComponent(filters)}`;
        }
        
        // Add search keywords if there's a confirmed search query
        if (serverSearchQuery) {
          const keywords = serverSearchQuery.split(',').map(k => k.trim()).join(',');
          url += `&keywords=${encodeURIComponent(keywords)}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        setResources(data.items || []);
        setTotalItems(data.total || 0);
      } catch (error) {
        console.error('Error fetching resources:', error);
        setResources([]);
        setTotalItems(0);
      } finally {
        setLoading(false);
      }
    };

    fetchResources();
  }, [location.pathname, currentPage, resourceType, serverSearchQuery]);

  useEffect(() => {
    getCurrentType();
  }, [getCurrentType]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Client-side filtering for immediate feedback
  const filteredResources = (resources || []).filter(resource => {
    if (!searchQuery) return true;
    
    const query = searchQuery.toLowerCase();
    return (
      resource.manifest.tags?.some(tag => tag?.toLowerCase().includes(query)) ||
      resource.manifest.name?.toLowerCase().includes(query) ||
      resource.manifest.description?.toLowerCase().includes(query)
    );
  });

  // Handle immediate search for client-side filtering
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  // Handle confirmed search for server-side filtering
  const handleSearchConfirm = (query: string) => {
    setSearchQuery(query);
    setServerSearchQuery(query);
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4">
        <SearchBar 
          onSearchChange={handleSearchChange}
          onSearchConfirm={handleSearchConfirm}
        />
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  return (
    <div className="container mx-auto px-4">
      <SearchBar 
        onSearchChange={handleSearchChange}
        onSearchConfirm={handleSearchConfirm}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
        {filteredResources.map((resource) => (
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