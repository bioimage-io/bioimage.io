import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import LoginButton from './LoginButton';
import { BiCube } from 'react-icons/bi';
import { BsDatabase } from 'react-icons/bs';
import { HiOutlineBeaker } from 'react-icons/hi';
import { IoDocumentTextOutline } from 'react-icons/io5';
import { AiOutlineInfoCircle } from 'react-icons/ai';

const Navbar: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-[1400px] mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Left section with logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <img 
                src="https://bioimage.io/static/img/bioimage-io-logo.svg"
                alt="BioImage.IO"
                className="h-8"
              />
            </Link>
          </div>

          {/* Center section with navigation */}
          <div className="hidden md:flex items-center space-x-4">
            <Link to="/models" className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900">
              <BiCube className="mr-2" size={20} />
              Models
            </Link>
            <Link to="/datasets" className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900">
              <BsDatabase className="mr-2" size={18} />
              Datasets
            </Link>
            <Link to="/applications" className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900">
              <HiOutlineBeaker className="mr-2" size={20} />
              Applications
            </Link>
            <Link to="/docs" className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900">
              <IoDocumentTextOutline className="mr-2" size={18} />
              Docs
            </Link>
            <Link to="/about" className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900">
              <AiOutlineInfoCircle className="mr-2" size={18} />
              About
            </Link>
          </div>

          {/* Right section with auth buttons */}
          <div className="flex items-center space-x-4">
            <LoginButton />
            
            {/* Mobile menu button */}
            <button 
              className="md:hidden"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <div className={`md:hidden ${isMobileMenuOpen ? 'block' : 'hidden'}`}>
          <div className="px-2 pt-2 pb-3 space-y-1">
            <Link 
              to="/models" 
              className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md"
            >
              <BiCube className="mr-2" size={20} />
              Models
            </Link>
            <Link 
              to="/datasets" 
              className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md"
            >
              <BsDatabase className="mr-2" size={18} />
              Datasets
            </Link>
            <Link 
              to="/applications" 
              className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md"
            >
              <HiOutlineBeaker className="mr-2" size={20} />
              Applications
            </Link>
            <Link 
              to="/docs" 
              className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md"
            >
              <IoDocumentTextOutline className="mr-2" size={18} />
              Docs
            </Link>
            <Link 
              to="/about" 
              className="flex items-center px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md"
            >
              <AiOutlineInfoCircle className="mr-2" size={18} />
              About
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 