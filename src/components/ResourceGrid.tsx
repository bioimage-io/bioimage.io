import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import { Resource } from '../types';
import SearchBar from './SearchBar';

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
        
        // Prepare keywords array
        const keywords: string[] = [];
        
        if (resourceType) {
          keywords.push(resourceType);
        }
        
        // Add search terms if there's a confirmed search query
        if (serverSearchQuery) {
          keywords.push(...serverSearchQuery.split(',').map(k => k.trim()));
        }
        
        // Add keywords to URL if we have any
        if (keywords.length > 0) {
          url += `&keywords=${encodeURIComponent(keywords.join(','))}`;
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
          <Link
            key={resource.id}
            to={`/?id=${encodeURIComponent(resource.id)}`}
            className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col h-full"
          >
            <div className="p-4 flex flex-col h-full">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-shrink-0 w-8">
                  {resource.manifest.icon ? (
                    <img
                      src={resource.manifest.icon}
                      alt={resource.manifest.name}
                      className="w-8 h-8 object-contain"
                    />
                  ) : resource.manifest.id_emoji ? (
                    <span className="text-2xl">{resource.manifest.id_emoji}</span>
                  ) : (
                    <div className="w-8 h-8 bg-gray-200 rounded-full" />
                  )}
                </div>
                <h3 className="text-base font-medium text-gray-900 break-words flex-grow">
                  {resource.manifest.name}
                </h3>
              </div>
              
              <p className="text-sm text-gray-600 mb-4 line-clamp-2 flex-grow">
                {resource.manifest.description}
              </p>

              <div className="space-y-2">
                {/* Tags */}
                <div className="flex flex-wrap gap-1.5">
                  {resource.manifest.tags?.slice(0, 3).map((tag: string) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs rounded-full border border-gray-100"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {/* Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {resource.manifest.badges?.map((badge) => (
                    <a
                      key={badge.url}
                      href={badge.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-100 flex items-center gap-1 hover:bg-blue-100 transition-colors"
                    >
                      {badge.icon && <img src={badge.icon} alt="" className="h-4" />}
                      {badge.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </Link>
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