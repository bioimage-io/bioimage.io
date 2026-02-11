import React, { useState, useRef, useEffect } from 'react';
import PartnerTooltip from './PartnerTooltip';
import { partnerService, Partner } from '../services/partnerService';

interface PartnerScrollProps {
  onPartnerClick?: (partnerId: string) => void;
}

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const PartnerScroll: React.FC<PartnerScrollProps> = ({ onPartnerClick }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [originalPartners, setOriginalPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    show: boolean;
    partner: Partner | null;
    position: { top: number; left: number };
  }>({
    show: false,
    partner: null,
    position: { top: 0, left: 0 }
  });
  const tooltipTimeoutRef = useRef<NodeJS.Timeout>();
  const showTooltipTimeoutRef = useRef<NodeJS.Timeout>();
  
  // Auto-reorder functionality
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isHoveringContainer, setIsHoveringContainer] = useState(false);
  const autoReorderIntervalRef = useRef<NodeJS.Timeout>();
  const interactionTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const fetchPartners = async () => {
      try {
        const partnersList = await partnerService.fetchPartners();
        setOriginalPartners(partnersList);
        setPartners(partnersList);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load partners');
      } finally {
        setLoading(false);
      }
    };

    fetchPartners();
  }, []);

  // Auto-reorder functionality
  useEffect(() => {
    if (originalPartners.length === 0) return;

    const startAutoReorder = () => {
      autoReorderIntervalRef.current = setInterval(() => {
        if (!isUserInteracting && !isTransitioning) {
          setIsTransitioning(true);
          
          // Smooth transition effect
          if (scrollRef.current) {
            scrollRef.current.style.transition = 'opacity 0.5s ease-in-out';
            scrollRef.current.style.opacity = '0.7';
          }
          
          setTimeout(() => {
            setPartners(prev => shuffleArray(prev));
            
            // Reset scroll position after reorder
            if (scrollRef.current) {
              scrollRef.current.scrollLeft = 0;
            }
            
            setTimeout(() => {
              if (scrollRef.current) {
                scrollRef.current.style.opacity = '1';
                scrollRef.current.style.transition = '';
              }
              setIsTransitioning(false);
            }, 200);
          }, 250);
        }
      }, 5000); // Reorder every 5 seconds (increased frequency)
    };

    startAutoReorder();

    return () => {
      if (autoReorderIntervalRef.current) {
        clearInterval(autoReorderIntervalRef.current);
      }
    };
  }, [originalPartners, isUserInteracting, isTransitioning]);

  // Handle user interaction states
  const handleUserInteractionStart = () => {
    setIsUserInteracting(true);
    
    // Clear any existing timeout
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
  };

  const handleUserInteractionEnd = () => {
    // Set a timeout to resume auto-reordering after user stops interacting
    interactionTimeoutRef.current = setTimeout(() => {
      setIsUserInteracting(false);
    }, 3000); // Resume auto-reorder 3 seconds after user stops interacting
  };

  const scroll = (direction: 'left' | 'right') => {
    handleUserInteractionStart();
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
    handleUserInteractionEnd();
  };

  const handlePartnerClick = (e: React.MouseEvent, partner: Partner) => {
    e.preventDefault(); // Prevent immediate navigation
    handleUserInteractionStart();
    if (onPartnerClick) {
      onPartnerClick(partner.id);
    }
    handleUserInteractionEnd();
  };

  const handleMouseEnter = (e: React.MouseEvent, partner: Partner) => {
    handleUserInteractionStart();
    
    // Clear any existing timeouts
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    if (showTooltipTimeoutRef.current) {
      clearTimeout(showTooltipTimeoutRef.current);
    }

    // Capture the position immediately
    const rect = e.currentTarget.getBoundingClientRect();
    const position = {
      top: rect.top + window.scrollY - 10,
      left: rect.left + (rect.width / 2)
    };

    // Set a timeout to show the tooltip after 800ms
    showTooltipTimeoutRef.current = setTimeout(() => {
      setTooltipState({
        show: true,
        partner,
        position
      });
    }, 800);
  };

  const handleMouseLeave = () => {
    handleUserInteractionEnd();
    
    // Clear the show timeout when mouse leaves
    if (showTooltipTimeoutRef.current) {
      clearTimeout(showTooltipTimeoutRef.current);
    }
    
    tooltipTimeoutRef.current = setTimeout(() => {
      setTooltipState(prev => ({ ...prev, show: false }));
    }, 100);
  };

  const handleContainerMouseEnter = () => {
    handleUserInteractionStart();
    setIsHoveringContainer(true);
  };

  const handleContainerMouseLeave = () => {
    handleUserInteractionEnd();
    setIsHoveringContainer(false);
  };

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
      if (showTooltipTimeoutRef.current) {
        clearTimeout(showTooltipTimeoutRef.current);
      }
      if (autoReorderIntervalRef.current) {
        clearInterval(autoReorderIntervalRef.current);
      }
      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-40">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ri-orange mb-4"></div>
          <p className="text-gray-500 text-sm">Loading partners...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 mt-8 mb-8">
        <div className="bg-white border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="relative max-w-[1400px] mx-auto px-4 sm:px-6 mt-12 mb-8 group"
      onMouseEnter={handleContainerMouseEnter}
      onMouseLeave={handleContainerMouseLeave}
    >

      {/* Content with relative positioning */}
      <div className="relative">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-ri-black mb-2">
            RI-SCALE Model Hub
          </h2>
          <div className="w-20 h-1 bg-ri-orange mx-auto rounded-full"></div>
          <p className="mt-4 text-gray-500">
            Supported by our amazing community partners in AI-powered research
          </p>
        </div>

        {/* Partners Container */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm transition-all duration-300">
          {/* Navigation Arrows */}
          {showLeftArrow && (
            <button
              onClick={() => scroll('left')}
              className="absolute left-0 top-1/2 transform -translate-y-1/2 z-10 bg-white shadow-md rounded-full p-2 border border-gray-100 hover:border-ri-orange hover:text-ri-orange transition-colors"
              aria-label="Scroll left"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          
          <div
            ref={scrollRef}
            className="flex overflow-x-auto space-x-4 py-6 px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              setShowLeftArrow(target.scrollLeft > 0);
              setShowRightArrow(
                target.scrollLeft < target.scrollWidth - target.clientWidth
              );
            }}
            onMouseEnter={handleUserInteractionStart}
            onMouseLeave={handleUserInteractionEnd}
          >
            {partners.map((partner, index) => (
              <div
                key={`${partner.id}-${index}`}
                className="flex flex-col items-center flex-shrink-0 w-24 sm:w-32 group/partner"
                onMouseEnter={(e) => handleMouseEnter(e, partner)}
                onMouseLeave={handleMouseLeave}
              >
                <button
                  onClick={(e) => handlePartnerClick(e, partner)}
                  className="flex flex-col items-center w-full"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center p-2 group-hover/partner:border-ri-orange transition-colors duration-200">
                    <img 
                      src={partner.icon} 
                      alt={partner.name} 
                      className="w-full h-full object-contain filter grayscale group-hover/partner:grayscale-0 transition-all duration-300"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        if (img.src !== window.location.origin + '/static/img/ri-scale-alt-logo.png') {
                          img.src = window.location.origin + '/static/img/ri-scale-alt-logo.png';
                        } else {
                          img.onerror = null;
                        }
                      }}
                    />
                  </div>
                  <span className="mt-2 text-xs sm:text-sm font-medium text-gray-500 group-hover/partner:text-ri-black transition-colors duration-200 text-center line-clamp-2">
                    {partner.name}
                  </span>
                </button>
              </div>
            ))}
          </div>

          {showRightArrow && (
            <button
              onClick={() => scroll('right')}
              className="absolute right-0 top-1/2 transform -translate-y-1/2 z-10 bg-white shadow-md rounded-full p-2 border border-gray-100 hover:border-ri-orange hover:text-ri-orange transition-colors"
              aria-label="Scroll right"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

        </div>
      </div>

      {/* Tooltip Portal */}
      {tooltipState.partner && (
        <PartnerTooltip
          name={tooltipState.partner.name}
          tooltip={tooltipState.partner.tooltip || ''}
          link={tooltipState.partner.link}
          position={tooltipState.position}
          show={tooltipState.show}
          onMouseEnter={() => {
            if (tooltipTimeoutRef.current) {
              clearTimeout(tooltipTimeoutRef.current);
            }
          }}
          onMouseLeave={handleMouseLeave}
        />
      )}
    </div>
  );
};

export default PartnerScroll;