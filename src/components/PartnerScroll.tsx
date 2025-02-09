import React, { useState, useRef, useEffect } from 'react';
import PartnerTooltip from './PartnerTooltip';

interface Partner {
  name: string;
  icon: string;
  link?: string;
  id: string;
  documentation?: string;
  git_repo?: string;
  tooltip?: string;
}

interface ManifestResponse {
  manifest: {
    documentation?: string;
    git_repo?: string;
    config: {
      docs?: string;
      partners: Array<{
        name: string;
        icon: string;
        id: string;
        docs?: string;
        splash_subtitle?: string;
      }>;
    };
  };
}

interface PartnerScrollProps {
  onPartnerClick?: (partnerId: string) => void;
}

const PartnerScroll: React.FC<PartnerScrollProps> = ({ onPartnerClick }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
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

  useEffect(() => {
    const fetchPartners = async () => {
      try {
        const response = await fetch('https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io');
        if (!response.ok) {
          throw new Error('Failed to fetch partners');
        }
        const data: ManifestResponse = await response.json();
        // Transform the partners data with documentation and links
        const partnersList = data.manifest.config.partners.map(partner => ({
          name: partner.name,
          icon: partner.icon,
          id: partner.id,
          // Prioritize docs from config, then documentation, then git_repo
          link: partner.docs,
          tooltip: partner.splash_subtitle || partner.name
        }));
        
        setPartners(partnersList);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load partners');
      } finally {
        setLoading(false);
      }
    };

    fetchPartners();
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handlePartnerClick = (e: React.MouseEvent, partner: Partner) => {
    e.preventDefault(); // Prevent immediate navigation
    if (onPartnerClick) {
      onPartnerClick(partner.id);
    }
  };

  const handleMouseEnter = (e: React.MouseEvent, partner: Partner) => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipState({
      show: true,
      partner,
      position: {
        top: rect.top + window.scrollY - 10,
        left: rect.left + (rect.width / 2)
      }
    });
  };

  const handleMouseLeave = () => {
    tooltipTimeoutRef.current = setTimeout(() => {
      setTooltipState(prev => ({ ...prev, show: false }));
    }, 100); // Small delay before hiding
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-500 p-4">
        Error loading partners: {error}
      </div>
    );
  }

  return (
    <div className="relative max-w-[1400px] mx-auto px-4 mt-8 mb-4">
      <h2 className="text text-center mb-2">Community Partners</h2>
      {showLeftArrow && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-white shadow-lg rounded-full p-2"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      
      <div
        ref={scrollRef}
        className="flex overflow-x-auto space-x-4 py-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          setShowLeftArrow(target.scrollLeft > 0);
          setShowRightArrow(
            target.scrollLeft < target.scrollWidth - target.clientWidth
          );
        }}
      >
        {partners.map((partner) => (
          <div
            key={partner.id}
            className="flex flex-col items-center space-y-2 min-w-[100px]"
            onMouseEnter={(e) => handleMouseEnter(e, partner)}
            onMouseLeave={handleMouseLeave}
          >
            <button
              onClick={(e) => handlePartnerClick(e, partner)}
              className="flex flex-col items-center space-y-2 hover:opacity-80 transition-opacity"
            >
              <img 
                src={partner.icon} 
                alt={partner.name} 
                className="w-12 h-12 object-contain"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.src = '/fallback-icon.png';
                }}
              />
              <span className="text-sm text-gray-600">{partner.name}</span>
            </button>
          </div>
        ))}
      </div>

      {showRightArrow && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-white shadow-lg rounded-full p-2"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

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