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
      <SearchIcon className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-gray-400 group-hover:text-ri-orange transition-colors duration-200 z-10" />
      <input
        type="text"
        value={value}
        placeholder="Search models..."
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && onSearchConfirm()}
        className="w-full h-12 px-3 sm:px-4 pl-10 sm:pl-12 pr-4 sm:pr-6 rounded-md bg-white border border-gray-200 hover:border-ri-orange focus:border-ri-orange focus:outline-none focus:ring-0 transition-colors duration-200 text-ri-black placeholder-gray-400 font-medium text-sm sm:text-base"
      />
    </div>
  );
};



export default SearchBar;