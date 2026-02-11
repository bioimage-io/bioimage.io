import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LoginButton from './LoginButton';
import { BiCube } from 'react-icons/bi';
import { BsDatabase, BsCollection, BsPeople } from 'react-icons/bs';
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
    // Elegant, minimal, high contrast
    const baseClasses = "flex items-center px-4 py-2 text-sm font-medium transition-colors duration-200 border-b-2";
    const activeClasses = "text-ri-black border-ri-orange";
    const inactiveClasses = "text-gray-600 border-transparent hover:text-ri-orange hover:border-gray-200";
    
    return `${baseClasses} ${isActivePath(path) ? activeClasses : inactiveClasses}`;
  };

  const mobileNavLinkClasses = (path: string): string => {
    const baseClasses = "flex items-center px-6 py-4 text-base font-medium transition-colors duration-200 border-l-4";
    const activeClasses = "text-ri-black border-ri-orange bg-gray-50";
    const inactiveClasses = "text-gray-600 border-transparent hover:text-ri-orange hover:bg-gray-50";
    
    return `${baseClasses} ${isActivePath(path) ? activeClasses : inactiveClasses}`;
  };

  return (
    <nav className="sticky top-0 z-50 bg-white shadow-sm border-b border-gray-100">
      <div className="max-w-[1400px] mx-auto px-6 h-20">
        <div className="flex items-center justify-between h-full">
          {/* Left section with logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center group">
              <img
                src="/static/img/ri-scale-model-hub-wide-alt.png" // Ensure this image works well on white background
                alt="RI-SCALE Model Hub"
                className="h-10 group-hover:opacity-90 transition-opacity duration-200"
              />
            </Link>
          </div>

          {/* Center section with navigation - Desktop */}
          <div className="hidden lg:flex items-center space-x-2 h-full pt-0.5">
            <Link to="/models" className={navLinkClasses("/models")}>
              <BiCube className="mr-2" size={18} />
              Models
            </Link>
            <Link 
              to="/docs" 
              className={navLinkClasses("/docs")}
            >
              <IoDocumentTextOutline className="mr-2" size={18} />
              Docs
            </Link>
            <Link to="/partners" className={navLinkClasses("/partners")}>
              <BsPeople className="mr-2" size={18} />
              Partners
            </Link>
            <Link to="/about" className={navLinkClasses("/about")}>
              <AiOutlineInfoCircle className="mr-2" size={18} />
              About
            </Link>
          </div>

          {/* Right section with auth buttons - Desktop */}
          <div className="hidden lg:flex items-center space-x-4">
            
            {location.pathname !== '/upload' && (
              <Link
                to="/upload"
                className="px-5 py-2 rounded-full border border-gray-300 text-gray-700 hover:border-ri-orange hover:text-ri-orange transition-all duration-200 flex items-center text-sm font-medium bg-white"
              >
                <IoCloudUploadOutline className="mr-2" size={16} />
                Upload
              </Link>
            )}
            {user?.email && location.pathname !== '/my-artifacts' && (
              <Link
                to="/my-artifacts"
                className="px-5 py-2 rounded-full text-white bg-ri-black hover:bg-gray-800 transition-all duration-200 flex items-center text-sm font-medium shadow-sm hover:shadow-md"
              >
                <BsCollection className="mr-2" size={16} />
                Artifacts
              </Link>
            )}
            <LoginButton />
          </div>
            
          {/* Mobile menu button */}
          <div className="lg:hidden flex items-center">
            <button 
              className="p-2 -mr-2 rounded-md hover:bg-gray-100 text-ri-black focus:outline-none"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle mobile menu"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-white border-t border-gray-100 shadow-xl absolute w-full left-0 z-40">
          <div className="py-2 space-y-1">
            <Link 
              to="/models" 
              className={mobileNavLinkClasses("/models")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <BiCube className="mr-3" size={20} />
              Models
            </Link>
            <Link 
              to="/docs"
              className={mobileNavLinkClasses("/docs")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <IoDocumentTextOutline className="mr-3" size={18} />
              Docs
            </Link>
            <Link 
              to="/partners" 
              className={mobileNavLinkClasses("/partners")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <BsPeople className="mr-3" size={18} />
              Partners
            </Link>
            <Link 
              to="/about" 
              className={mobileNavLinkClasses("/about")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <AiOutlineInfoCircle className="mr-3" size={18} />
              About
            </Link>

            {user?.email && (
              <Link 
                to="/my-artifacts" 
                className={mobileNavLinkClasses("/my-artifacts")}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <BsCollection className="mr-3" size={18} />
                Artifacts
              </Link>
            )}

            <Link 
              to="/upload" 
              className={mobileNavLinkClasses("/upload")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <IoCloudUploadOutline className="mr-3" size={18} />
              Upload
            </Link>

            <div className="border-t border-gray-100 my-2"></div>
            <div className="px-6 py-4">
              <LoginButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;