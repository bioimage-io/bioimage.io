import React from 'react';
import SearchIcon from '@mui/icons-material/Search';

interface SearchBarProps {
  value: string;
  onSearchChange: (query: string) => void;
  onSearchConfirm: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ value, onSearchChange, onSearchConfirm }) => {
  return (
    <div className="w-full relative group">
      <SearchIcon className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-gray-500 group-hover:text-blue-600 transition-colors duration-300 z-10" />
      <input
        type="text"
        value={value}
        placeholder="Search models..."
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && onSearchConfirm()}
        className="w-full h-12 px-3 sm:px-4 pl-10 sm:pl-12 pr-4 sm:pr-6 rounded-lg bg-white/80 backdrop-blur-sm border border-gray-200/70 hover:border-blue-200/60 focus:border-blue-300/70 focus:outline-none focus:ring-0 transition-all duration-300 text-gray-800 placeholder-gray-500 shadow-sm hover:shadow-md focus:shadow-md hover:bg-white/90 focus:bg-white/95 font-medium text-sm sm:text-base"
      />
      <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-50/20 via-purple-50/10 to-cyan-50/20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
    </div>
  );
};

export default SearchBar; 