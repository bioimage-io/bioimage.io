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
    const baseClasses = "flex items-center px-4 py-2 rounded-xl transition-all duration-300";
    const activeClasses = "text-blue-700 font-semibold";
    const inactiveClasses = "text-gray-700 hover:text-blue-600";
    
    return `${baseClasses} ${isActivePath(path) ? activeClasses : inactiveClasses}`;
  };

  const mobileNavLinkClasses = (path: string): string => {
    const baseClasses = "flex items-center px-4 py-3 rounded-xl transition-all duration-300";
    const activeClasses = "text-blue-700 font-semibold";
    const inactiveClasses = "text-gray-700 hover:text-blue-600";
    
    return `${baseClasses} ${isActivePath(path) ? activeClasses : inactiveClasses}`;
  };

  return (
    <nav className="sticky top-0 z-50 bg-gradient-to-r from-blue-100/90 via-purple-100/85 to-cyan-100/90 backdrop-blur-lg border-b border-blue-200/40 shadow-xl shadow-blue-300/20 h-16">
      <div className="max-w-[1400px] mx-auto px-6 h-full">
        <div className="flex items-center justify-between h-full">
          {/* Left section with logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center group">
              <img
                src="/static/img/ri-scale-model-hub-wide-alt.png"
                alt="RI-SCALE Model Hub"
                className="h-10 group-hover:scale-105 transition-transform duration-300"
              />
            </Link>
          </div>

          {/* Center section with navigation */}
          <div className="hidden lg:flex items-center space-x-2">
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
              href="https://modelhub.riscale.eu/docs" 
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
          <div className="flex items-center space-x-3">
            {/* Move Upload and Login buttons to desktop-only view */}
            <div className="hidden lg:flex items-center space-x-3">
              
              {location.pathname !== '/upload' && (
                <Link
                  to="/upload"
                  className="px-4 py-2 rounded-xl bg-blue-50/80 text-blue-700 hover:bg-blue-100/90 hover:text-blue-800 transition-all duration-300 flex items-center backdrop-blur-sm border border-blue-200/60 hover:border-blue-300/70 hover:shadow-md font-medium"
                >
                  <IoCloudUploadOutline className="mr-2" size={18} />
                  Upload
                </Link>
              )}
              {user?.email && location.pathname !== '/my-artifacts' && (
                <Link
                  to="/my-artifacts"
                  className="px-4 py-2 rounded-xl bg-white/80 text-gray-700 hover:bg-white/95 hover:text-blue-600 transition-all duration-300 flex items-center backdrop-blur-sm border border-blue-200/50 hover:border-blue-300/60 hover:shadow-lg font-medium"
                >
                  <BsCollection className="mr-2" size={18} />
                  Artifacts
                </Link>
              )}
              <LoginButton />
            </div>
            
            {/* Mobile menu button */}
            <button 
              className="lg:hidden p-2.5 rounded-xl bg-white/80 hover:bg-white/95 transition-all duration-300 backdrop-blur-sm border border-blue-200/50 hover:border-blue-300/60 hover:shadow-lg"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle mobile menu"
              title="Toggle mobile menu"
            >
              <svg className="h-6 w-6 text-gray-600 hover:text-blue-600 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <div className={`lg:hidden ${isMobileMenuOpen ? 'block' : 'hidden'}`}>
          <div className="px-4 pt-4 pb-6 space-y-3 bg-white/90 backdrop-blur-lg rounded-2xl mt-4 mb-4 border border-blue-200/50 shadow-2xl shadow-blue-200/30">
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
              className="flex items-center px-4 py-3 rounded-xl bg-blue-50/80 text-blue-700 hover:bg-blue-100/90 hover:text-blue-800 transition-all duration-300 backdrop-blur-sm border border-blue-200/60 hover:border-blue-300/70 hover:shadow-md font-medium"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <IoCloudUploadOutline className="mr-3" size={18} />
              Upload
            </Link>
            <Link 
              to="/models" 
              className={mobileNavLinkClasses("/models")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <BiCube className="mr-3" size={20} />
              Models
            </Link>
            <Link 
              to="/datasets" 
              className={mobileNavLinkClasses("/datasets")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <BsDatabase className="mr-3" size={18} />
              Datasets
            </Link>
            <Link 
              to="/applications" 
              className={mobileNavLinkClasses("/applications")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <HiOutlineBeaker className="mr-3" size={20} />
              Applications
            </Link>
            <a 
              href="https://modelhub.riscale.eu/docs"
              className={mobileNavLinkClasses("/docs")}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <IoDocumentTextOutline className="mr-3" size={18} />
              Docs
            </a>
            <Link 
              to="/about" 
              className={mobileNavLinkClasses("/about")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <AiOutlineInfoCircle className="mr-3" size={18} />
              About
            </Link>

            {/* Add divider */}
            <div className="border-t border-blue-200/50 my-4"></div>

            {/* Add Login button to mobile menu */}
            <div className="px-4 py-2">
              <LoginButton />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 