import React from 'react';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
  return (
    <footer className="w-full mt-24 bg-black text-white border-t border-gray-800 py-12">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex flex-col lg:flex-row justify-between items-center gap-8">
          
          {/* Left: Branding & Links */}
          <div className="flex flex-col items-center lg:items-start space-y-4">
             {/* RI-SCALE Logo */}
            <img 
              src="/static/img/ri-scale-alt-logo.png" 
              onError={(e) => {
                e.currentTarget.src = "/static/img/ri-scale-logo.png";
              }}
              alt="RI-SCALE" 
              className="h-12 w-auto object-contain brightness-0 invert"
            />
            
            <div className="flex flex-wrap justify-center gap-6 text-sm font-medium text-gray-400">
              <Link to="/toc" className="hover:text-[#f39200] transition-colors">
                Terms of Service
              </Link>
              <Link to="/docs" className="hover:text-[#f39200] transition-colors">
                API Docs
              </Link>
              <a href="https://riscale.eu" target="_blank" rel="noreferrer" className="hover:text-[#f39200] transition-colors">
                About RI-SCALE
              </a>
               <a 
                  href="https://creativecommons.org/licenses/by/4.0/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hover:text-[#f39200] transition-colors"
                >
                  Content License (CC-BY 4.0)
                </a>
            </div>
            
            <p className="text-xs text-gray-500">
               © {new Date().getFullYear()} RI-SCALE Model Hub
            </p>
          </div>

          {/* Right: EU Funding */}
          <div className="flex items-center gap-4">
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/b/b7/Flag_of_Europe.svg"
              alt="EU Flag"
              className="h-8 w-auto"
            />
            <p className="text-[10px] text-white leading-snug max-w-[200px] text-left">
              RI-SCALE is funded by the European Union Grant Agreement Number&nbsp;10188168
            </p>
          </div>

        </div>
      </div>
    </footer>
  );
};

export default Footer;