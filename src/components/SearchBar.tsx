import React, { useState, useCallback, useEffect } from 'react';

interface SearchBarProps {
  onSearchChange: (query: string) => void;
  onSearchConfirm: (query: string) => void;
  initialValue?: string;
  placeholder?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({ 
  onSearchChange,
  onSearchConfirm,
  initialValue = '',
  placeholder = "Filter by tags or search resources..." 
}) => {
  const [value, setValue] = useState(initialValue);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    onSearchChange(newValue);

    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Set new timeout for server-side filtering
    const timeout = setTimeout(() => {
      onSearchConfirm(newValue);
    }, 500); // 500ms delay

    setSearchTimeout(timeout);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchConfirm(value);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 mt-8">
      <form onSubmit={(e) => { e.preventDefault(); onSearchConfirm(value); }} className="relative">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button 
          type="submit"
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>
    </div>
  );
};

export default SearchBar; 