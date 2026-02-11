import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import SearchBar from './SearchBar';
import ArtifactCard from './ArtifactCard';
import { Grid } from '@mui/material';
import TagSelection from './TagSelection';

interface ResourceGridProps {
  type?: 'model';
}

const PHRASES = [
  "nucleus segmentation",
  "spot detection",
  "cell painting",
  "standardized AI"
];

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export const Pagination = ({ currentPage, totalPages, totalItems, onPageChange }: PaginationProps) => {
  const getPageNumbers = () => {
    const delta = 2; // Number of pages to show around current page
    const range = [];
    const rangeWithDots = [];

    // Always include first page
    range.push(1);

    // Add pages around current page
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }

    // Always include last page (if more than 1 page)
    if (totalPages > 1) {
      range.push(totalPages);
    }

    // Remove duplicates and sort
    const uniqueRange = Array.from(new Set(range)).sort((a, b) => a - b);

    // Add ellipsis where there are gaps
    let prev = 0;
    for (const page of uniqueRange) {
      if (page - prev > 1) {
        rangeWithDots.push('...');
      }
      rangeWithDots.push(page);
      prev = page;
    }

    return rangeWithDots;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className="flex justify-center items-center gap-2 mt-12 flex-wrap">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-2 rounded-md bg-white border border-gray-200 text-gray-700 hover:border-ri-orange hover:text-ri-orange disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-sm"
      >
        Previous
      </button>
      
      {/* Page numbers with ellipsis */}
      {pageNumbers.map((pageNum, index) => {
        if (pageNum === '...') {
          return (
            <span key={`ellipsis-${index}`} className="px-2 py-2 text-gray-400">
              ...
            </span>
          );
        }
        
        return (
          <button
            key={pageNum}
            onClick={() => onPageChange(pageNum as number)}
            className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
              currentPage === pageNum 
                ? 'bg-ri-black text-white border-ri-black' 
                : 'bg-white border-gray-200 text-gray-700 hover:border-ri-orange hover:text-ri-orange'
            }`}
          >
            {pageNum}
          </button>
        );
      })}
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-2 rounded-md bg-white border border-gray-200 text-gray-700 hover:border-ri-orange hover:text-ri-orange disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-sm"
      >
        Next
      </button>
      
      {/* Page info */}
      <div className="ml-4 text-xs font-mono text-gray-500 hidden sm:block">
        Page {currentPage} of {totalPages} ({totalItems} items)
      </div>
    </div>
  );
};

// Add this overlay spinner component
const LoadingOverlay = () => (
  <div className="fixed inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-8 flex flex-col items-center shadow-xl border border-gray-100">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-100 border-t-ri-orange mb-4"></div>
      <div className="text-base font-semibold text-ri-black">Loading models...</div>
    </div>
  </div>
);

export const ArtifactGrid: React.FC<ResourceGridProps> = ({ type }) => {
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const location = useLocation();
  const { 
    resources,
    setResourceType,
    fetchResources,
    totalItems,
    itemsPerPage
  } = useHyphaStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Typewriter effect state
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    let timer: NodeJS.Timeout;
    const currentPhrase = PHRASES[phraseIndex];
    const typingSpeed = isDeleting ? 40 : 80;
    const pauseTime = 2000;

    const handleTyping = () => {
      // If full phrase is typed
      if (!isDeleting && text === currentPhrase) {
        timer = setTimeout(() => setIsDeleting(true), pauseTime);
        return;
      }

      // If phrase is fully deleted
      if (isDeleting && text === '') {
        setIsDeleting(false);
        setPhraseIndex(prev => (prev + 1) % PHRASES.length);
        return;
      }

      const nextText = isDeleting 
        ? currentPhrase.substring(0, text.length - 1)
        : currentPhrase.substring(0, text.length + 1);

      setText(nextText);
    };

    timer = setTimeout(handleTyping, typingSpeed);
    return () => clearTimeout(timer);
  }, [text, isDeleting, phraseIndex]);

  useEffect(() => {
    // Force resource type to model
    setResourceType('model');
    // Reset to first page when artifact type changes
    setCurrentPage(1);
  }, [setResourceType]);


  useEffect(() => {
    const loadResources = async () => {
      try {
        // Cancel any ongoing request
        if (abortController) {
          abortController.abort();
        }

        // Create new abort controller for this request
        const newAbortController = new AbortController();
        setAbortController(newAbortController);

        setLoading(true);
        await fetchResources(currentPage, serverSearchQuery, {
          tags: selectedTags
        });
      } catch (error) {
        // Don't set loading to false if the request was aborted
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Error loading resources:', error);
      } finally {
        setLoading(false);
        setAbortController(null);
      }
    };

    loadResources();
  }, [location.pathname, currentPage, serverSearchQuery, selectedTags, fetchResources]);

  // Cleanup effect to cancel ongoing requests when component unmounts
  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort();
      }
    };
  }, [abortController]);

  // Improved debounced server search that respects user typing
  useEffect(() => {
    // Only set up debounced search if user is actively typing
    if (isTyping) {
      const timer = setTimeout(() => {
        setIsTyping(false);
        setServerSearchQuery(searchQuery);
        setCurrentPage(1);
      }, 800); // Slightly longer delay for better UX

      return () => clearTimeout(timer);
    }
  }, [searchQuery, isTyping]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle search input changes with improved UX
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setIsTyping(true);
    
    // Cancel any ongoing request when user starts typing
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  };

  // Handle immediate search when user hits Enter
  const handleSearchConfirm = () => {
    setIsTyping(false);
    setServerSearchQuery(searchQuery);
    setCurrentPage(1);
  };

  const handleTagSelect = (tag: string) => {
    setSelectedTags(prev => {
      return [tag];
    });
    setSearchQuery(tag);
    setIsTyping(false);
    setServerSearchQuery(tag);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <div className="w-full">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Simple divider instead of gradient */}
        <div className="w-full h-px bg-gray-100 mb-8 sm:mb-12"></div>
         
        {/* Show loading overlay when loading (but not when just typing) */}
        {loading && !isTyping && <LoadingOverlay />}
        
        <div className="relative mb-8 sm:mb-12">
          {/* Welcome Blurb */}
          <div className="mb-10 text-center max-w-4xl mx-auto">
            <h1 className="text-3xl sm:text-4xl font-bold text-ri-black mb-4">
              Discover <span className="text-ri-orange inline-block min-w-[200px]">{text}</span> models
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Access a curated collection of AI models designed for scientific workflows. 
              Brought to you by <Link to="/about" className="text-black hover:text-ri-black font-semibold transition-colors">RI-SCALE</Link>.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-6 items-start">
             <div className="flex-1 w-full">
                <SearchBar 
                  value={searchQuery}
                  onSearchChange={handleSearchChange}
                  onSearchConfirm={handleSearchConfirm}
                />
              </div>
              <div className="flex-none w-full sm:w-auto">
                <TagSelection 
                  onTagSelect={handleTagSelect}
                  selectedTags={selectedTags}
                />
              </div>
            </div>
          </div>

        {/* Resources Grid */}
         {resources && resources.length > 0 ? (
          <Grid container spacing={3}>
            {resources.map((resource) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={resource.id}>
                <ArtifactCard artifact={resource} />
              </Grid>
            ))}
          </Grid>
        ) : (
          !loading && (
            <div className="text-center py-24 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xl text-gray-500 font-medium">No models found matching your criteria.</p>
              <button 
                onClick={() => {
                   setSearchQuery('');
                   setServerSearchQuery('');
                   setSelectedTags([]);
                }}
                className="mt-4 text-ri-orange hover:text-ri-black underline transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )
        )}

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={handlePageChange}
          />
      </div>
    </div>
  );
};

export default ArtifactGrid;