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
      className="fixed bg-white/90 backdrop-blur-lg text-gray-800 text-xs rounded-2xl py-4 px-5 w-[280px] shadow-xl border border-blue-200/50 z-[100] transition-all duration-300"
      style={{ 
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translate(-50%, -100%)'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="font-semibold text-base mb-3 text-center bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
        {name}
      </div>
      <div className="text-center mb-4 text-gray-600 leading-relaxed">
        {tooltip}
      </div>
      {link && (
        <>
          <div className="border-t border-blue-100/50 my-3"></div>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-blue-600 hover:text-blue-800 font-medium text-sm transition-colors duration-300 hover:scale-105 transform"
          >
            Read more →
          </a>
        </>
      )}
      {/* Tooltip arrow */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-8 border-transparent border-t-white/90"/>
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-[-2px] border-8 border-transparent border-t-blue-200/50"/>
    </div>,
    document.body
  );
};

export default PartnerTooltip; 