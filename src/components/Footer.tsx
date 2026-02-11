import React from 'react';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
  return (
    <footer className="w-full py-12 px-4 mt-16 bg-gradient-to-b from-blue-100/60 via-purple-100/40 to-cyan-100/50 backdrop-blur-sm border-t border-blue-200/50">
      <div className="max-w-[1400px] mx-auto">
        {/* Content Section */}
        <div className="text-center space-y-8 max-w-4xl mx-auto">
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-white/50 p-8  transition-all duration-300">
            {/* Made with love */}
            <div className="mb-6">
              <p className="text-lg font-semibold text-gray-700 mb-4">
                Made with <span role="img" aria-label="love" className="text-red-500 animate-pulse">❤️</span> by the RI-SCALE community
              </p>
            </div>
            
            <img
              src="/static/img/EuropeanFlag-Funded by the EU-POS.jpg"
              alt="Funded by the European Union"
              className="w-full max-w-xs mx-auto mb-6 rounded-xl transition-shadow duration-300"
            />
            
            <p className="text-base text-gray-700 leading-relaxed px-4 mb-4 font-medium">
              RI-SCALE Model Hub -- a collaborative effort to bring AI models to research infrastructures, powered by the RI-SCALE consortium
            </p>
            
            <p className="text-sm text-gray-600 leading-relaxed px-4">
              RI-SCALE receives funding from the European Union's Horizon Europe research and innovation programme under grant agreement number 10188168. Views and opinions expressed are however those of the author(s) only and do not necessarily reflect those of the European Union or the European Research Council Executive Agency. Neither the European Union nor the granting authority can be held responsible for them.
            </p>
          </div>

          {/* License and Terms */}
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-white/50 p-6  transition-all duration-300">
            <div className="flex flex-col items-center justify-center space-y-3">
              <p className="text-sm text-gray-700">
                All content is licensed under{' '}
                <a 
                  href="https://creativecommons.org/licenses/by/4.0/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-medium hover:underline transition-all duration-300"
                >
                  CC-BY 4.0
                </a>
                {' '}unless explicitly specified otherwise
              </p>
              <p className="text-sm text-gray-700">
                <Link 
                  to="/toc" 
                  className="text-blue-600 hover:text-blue-800 font-medium hover:underline transition-all duration-300 hover:scale-105 transform inline-block"
                >
                  Terms of Service
                </Link>
              </p>
              <p className="text-sm text-gray-600">
                <Link 
                  to="/api" 
                  className="text-purple-600 hover:text-purple-800 font-medium hover:underline transition-all duration-300"
                >
                  API Documentation
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer; 