import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface PartnerTooltipProps {
  name: string;
  tooltip: string;
  link?: string;
  position: { top: number; left: number };
  show: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const PartnerTooltip: React.FC<PartnerTooltipProps> = ({ 
  name, 
  tooltip, 
  link, 
  position, 
  show,
  onMouseEnter,
  onMouseLeave 
}) => {
  if (!show) return null;

  return createPortal(
    <div 
      className="fixed bg-white text-gray-800 text-xs rounded-lg py-3 px-4 w-[250px] shadow-xl border border-gray-200 z-[100]"
      style={{ 
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translate(-50%, -100%)'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="font-semibold text-sm mb-2 text-center">
        {name}
      </div>
      <div className="text-center mb-3 text-gray-600">
        {tooltip}
      </div>
      <div className="border-t border-gray-200 my-2"></div>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-blue-600 hover:text-blue-800 underline mt-2"
        >
          Read more →
        </a>
      )}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-8 border-transparent border-t-white"/>
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-[-1px] border-8 border-transparent border-t-gray-200"/>
    </div>,
    document.body
  );
};

export default PartnerTooltip; 