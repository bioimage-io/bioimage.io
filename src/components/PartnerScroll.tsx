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
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600 text-sm animate-pulse">Loading community partners...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 mt-8 mb-8">
        <div className="bg-red-50/80 backdrop-blur-sm rounded-2xl border border-red-200/50 p-6 text-center shadow-lg">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-red-800 mb-2">Unable to Load Partners</h3>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="relative max-w-[1400px] mx-auto px-2 sm:px-6 mt-8 sm:mt-12 mb-4 sm:mb-8 group"
      onMouseEnter={handleContainerMouseEnter}
      onMouseLeave={handleContainerMouseLeave}
    >

      {/* Content with relative positioning */}
      <div className="relative">
        {/* Fancy Header */}
        <div className="text-center">
          <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent mb-3">
            RI-SCALE Model Hub
          </h2>
          <div className="w-24 h-1 bg-gradient-to-r from-blue-500 to-purple-500 mx-auto mt-3 rounded-full"></div>
          <p className="mt-4 text-gray-600 text-lg">
            Supported by our amazing community partners in AI-powered bioimage analysis
          </p>
          
        </div>

        {/* Partners Container */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 transition-all duration-300">
          {/* Navigation Arrows */}
          {showLeftArrow && (
            <button
              onClick={() => scroll('left')}
              className="absolute left-1 sm:left-2 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 backdrop-blur-sm shadow-lg rounded-xl p-2 sm:p-3 border border-blue-200/50 hover:bg-white hover:shadow-xl hover:border-blue-300/60 transition-all duration-300 hover:scale-105 opacity-0 group-hover:opacity-100"
              aria-label="Scroll left to see previous partners"
              title="Previous partners"
            >
              <svg className="w-4 h-4 sm:w-6 sm:h-6 text-gray-600 hover:text-blue-600 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          
          <div
            ref={scrollRef}
            className="flex overflow-x-auto space-x-2 sm:space-x-3 py-3 sm:py-4 px-2 sm:px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
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
                key={`${partner.id}-${index}`} // Include index to help with transitions
                className="flex flex-col items-center space-y-2 sm:space-y-3 min-w-[80px] sm:min-w-[100px] group/partner"
                onMouseEnter={(e) => handleMouseEnter(e, partner)}
                onMouseLeave={handleMouseLeave}
              >
                <button
                  onClick={(e) => handlePartnerClick(e, partner)}
                  className="flex flex-col items-center space-y-2 sm:space-y-3 p-1 rounded-2xl transition-all duration-300 hover:scale-102"
                >
                  <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-100/50 flex items-center justify-center p-1.5 sm:p-2 group-hover/partner:from-blue-100 group-hover/partner:to-purple-100 transition-all duration-300">
                    <img 
                      src={partner.icon} 
                      alt={partner.name} 
                      className="w-8 h-8 sm:w-12 sm:h-12 object-contain group-hover/partner:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        // Prevent infinite loop by checking if we're already using the fallback
                        if (img.src !== window.location.origin + '/static/img/ri-scale-alt-logo.png') {
                          img.src = window.location.origin + '/static/img/ri-scale-alt-logo.png';
                        } else {
                          // If even the fallback fails, remove the onError handler to prevent further loops
                          img.onerror = null;
                          console.warn('Both original and fallback icon failed to load for partner:', partner.name);
                        }
                      }}
                    />
                  </div>
                  <span className="text-xs sm:text-sm font-medium text-gray-700 group-hover/partner:text-blue-600 transition-colors duration-300 text-center leading-tight">
                    {partner.name}
                  </span>
                </button>
              </div>
            ))}
          </div>

          {showRightArrow && (
            <button
              onClick={() => scroll('right')}
              className="absolute right-1 sm:right-2 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 backdrop-blur-sm shadow-lg rounded-xl p-2 sm:p-3 border border-blue-200/50 hover:bg-white hover:shadow-xl hover:border-blue-300/60 transition-all duration-300 hover:scale-105 opacity-0 group-hover:opacity-100"
              aria-label="Scroll right to see more partners"
              title="More partners"
            >
              <svg className="w-4 h-4 sm:w-6 sm:h-6 text-gray-600 hover:text-blue-600 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Auto-reorder indicator - moved to bottom center */}
          {!isUserInteracting && isHoveringContainer && (
            <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 z-10">
              <div className="bg-gray-100/60 backdrop-blur-sm rounded-full px-2 py-1 text-xs text-gray-500 font-normal border border-gray-200/30">
                Auto-rotating
              </div>
            </div>
          )}
          <div className="w-full h-1 bg-gradient-to-r from-transparent via-blue-100 via-purple-100 to-transparent mt-3 rounded-full transition-all duration-300"></div>
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