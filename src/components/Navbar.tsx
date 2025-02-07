import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LoginButton from './LoginButton';
import { BiCube } from 'react-icons/bi';
import { BsDatabase, BsCollection } from 'react-icons/bs';
import { HiOutlineBeaker } from 'react-icons/hi';
import { IoDocumentTextOutline, IoCloudUploadOutline } from 'react-icons/io5';
import { AiOutlineInfoCircle } from 'react-icons/ai';
import { RiLoginBoxLine } from 'react-icons/ri';
import { useHyphaStore } from '../store/hyphaStore';

const Navbar: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useHyphaStore();

  const isActivePath = (path: string): boolean => {
    return location.pathname.startsWith(path);
  };

  const navLinkClasses = (path: string): string => {
    const baseClasses = "flex items-center px-3 py-2";
    const activeClasses = "text-blue-600 font-medium";
    const inactiveClasses = "text-gray-700 hover:text-gray-900";
    
    return `${baseClasses} ${isActivePath(path) ? activeClasses : inactiveClasses}`;
  };

  const mobileNavLinkClasses = (path: string): string => {
    const baseClasses = "flex items-center px-3 py-2 rounded-md hover:bg-gray-50";
    const activeClasses = "text-blue-600 font-medium bg-blue-50";
    const inactiveClasses = "text-gray-700 hover:text-gray-900";
    
    return `${baseClasses} ${isActivePath(path) ? activeClasses : inactiveClasses}`;
  };

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
                className="h-12"
              />
            </Link>
          </div>

          {/* Center section with navigation */}
          <div className="hidden md:flex items-center space-x-4">
            <Link to="/models" className={navLinkClasses("/models")}>
              <BiCube className="mr-2" size={20} />
              Models
            </Link>
            <Link to="/datasets" className={navLinkClasses("/datasets")}>
              <BsDatabase className="mr-2" size={18} />
              Datasets
            </Link>
            <Link to="/applications" className={navLinkClasses("/applications")}>
              <HiOutlineBeaker className="mr-2" size={20} />
              Applications
            </Link>
            <a 
              href="https://bioimage.io/docs" 
              className={navLinkClasses("/docs")}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IoDocumentTextOutline className="mr-2" size={18} />
              Docs
            </a>
            <Link to="/about" className={navLinkClasses("/about")}>
              <AiOutlineInfoCircle className="mr-2" size={18} />
              About
            </Link>
          </div>

          {/* Right section with auth buttons */}
          <div className="flex items-center space-x-4">
            {/* Move Upload and Login buttons to desktop-only view */}
            <div className="hidden md:flex items-center space-x-4">
              
              {location.pathname !== '/upload' && (
                <Link
                  to="/upload"
                  className="hover:bg-gray-50 px-4 py-2 rounded-md flex items-center"
                >
                  <IoCloudUploadOutline className="mr-2" size={18} />
                  Upload
                </Link>
              )}
              {user?.email && location.pathname !== '/my-artifacts' && (
                <Link
                  to="/my-artifacts"
                  className="hover:bg-gray-50 px-4 py-2 rounded-md flex items-center"
                >
                  <BsCollection className="mr-2" size={18} />
                  Artifacts
                </Link>
              )}
              <LoginButton />
            </div>
            
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
            {user?.email && (
              <Link 
                to="/my-artifacts" 
                className={mobileNavLinkClasses("/my-artifacts")}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <BsCollection className="mr-2" size={18} />
                Artifacts
              </Link>
            )}
            <Link 
              to="/upload" 
              className={mobileNavLinkClasses("/upload")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <IoCloudUploadOutline className="mr-2" size={18} />
              Upload
            </Link>
            <Link 
              to="/models" 
              className={mobileNavLinkClasses("/models")}
            >
              <BiCube className="mr-2" size={20} />
              Models
            </Link>
            <Link 
              to="/datasets" 
              className={mobileNavLinkClasses("/datasets")}
            >
              <BsDatabase className="mr-2" size={18} />
              Datasets
            </Link>
            <Link 
              to="/applications" 
              className={mobileNavLinkClasses("/applications")}
            >
              <HiOutlineBeaker className="mr-2" size={20} />
              Applications
            </Link>
            <a 
              href="https://bioimage.io/docs"
              className={mobileNavLinkClasses("/docs")}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IoDocumentTextOutline className="mr-2" size={18} />
              Docs
            </a>
            <Link 
              to="/about" 
              className={mobileNavLinkClasses("/about")}
            >
              <AiOutlineInfoCircle className="mr-2" size={18} />
              About
            </Link>

            {/* Add divider */}
            <div className="border-t border-gray-200 my-2"></div>

            {/* Add Upload and Login buttons to mobile menu */}
            {location.pathname !== '/upload' && (
              <Link 
                to="/upload" 
                className={mobileNavLinkClasses("/upload")}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <IoCloudUploadOutline className="mr-2" size={18} />
                Upload
              </Link>
            )}
            <div className="px-3 py-2">
              <LoginButton />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 