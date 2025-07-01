import React from 'react';
import { Link } from 'react-router-dom';

const footerLinks = [
  {
    label: "Ask a question on image.sc forum",
    href: "https://forum.image.sc/tag/bioimageio",
    icon: "/static/img/imagesc-logo.png",
    caption: "Question"
  },
  {
    label: "Give us some feedback through this Google Form",
    href: "https://forms.gle/CA1yK4pUKMqBPtso8",
    icon: "/static/img/feedback-icon.png",
    caption: "Feedback Form"
  },
  {
    label: "Github Repository",
    href: "https://github.com/bioimage-io/bioimage.io",
    icon: "/static/img/github.png",
    caption: "Source Code"
  },
  {
    label: "Send us a message",
    href: "https://oeway.typeform.com/to/K3j2tJt7",
    icon: "/static/img/contact.png",
    caption: "Contact Us"
  },
  {
    label: "We receive funding through the AI4Life project with support from the European Union's Horizon Europe research and innovation programme under grant agreement number 101057970",
    href: "https://ai4life.eurobioimaging.eu/",
    icon: "/static/img/AI4Life-logo-giraffe.png",
    caption: "AI4Life"
  },
  {
    label: "This site is powered by Netlify",
    href: "https://www.netlify.com",
    icon: "https://www.netlify.com/img/global/badges/netlify-color-accent.svg",
    caption: "Deploys By Netlify"
  }
];

const Footer: React.FC = () => {
  return (
    <footer className="w-full py-12 px-4 mt-16 bg-gradient-to-b from-blue-100/60 via-purple-100/40 to-cyan-100/50 backdrop-blur-sm border-t border-blue-200/50">
      <div className="max-w-[1400px] mx-auto">
        {/* Links Section */}
        <div className="flex flex-wrap justify-center items-start gap-6 mb-12">
          {footerLinks.map((link, index) => (
            <div key={index} className="w-36 sm:w-44 text-center flex-shrink-0">
              <div className="group relative h-full" title={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full h-full p-4 rounded-2xl bg-white/60 backdrop-blur-sm border border-white/50 hover:bg-white/80 hover:border-blue-200/60 hover:shadow-lg transition-all duration-300 hover:scale-105 hover:-translate-y-1"
                >
                  <figure className="flex flex-col items-center">
                    <img
                      src={link.icon}
                      alt={link.caption}
                      className="h-[45px] w-auto object-contain mb-3 group-hover:scale-110 transition-transform duration-300"
                    />
                    <figcaption className="text-sm text-gray-700 font-medium hidden md:block group-hover:text-blue-600 transition-colors duration-300">
                      {link.caption}
                    </figcaption>
                  </figure>
                </a>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-4 py-3 bg-gray-900/90 backdrop-blur-sm text-white text-xs rounded-xl shadow-xl whitespace-nowrap z-10 border border-gray-700/50">
                  {link.label}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900/90"/>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Content Section */}
        <div className="text-center space-y-8 max-w-4xl mx-auto">
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-white/50 p-8  transition-all duration-300">
            {/* Made with love */}
            <div className="mb-6">
              <p className="text-lg font-semibold text-gray-700 mb-4">
                Made with <span role="img" aria-label="love" className="text-red-500 animate-pulse">❤️</span> by the BioImage Model Zoo community
              </p>
            </div>
            
            <img
              src="/static/img/EuropeanFlag-Funded by the EU-POS.jpg"
              alt="Funded by the European Union"
              className="w-full max-w-xs mx-auto mb-6 rounded-xl transition-shadow duration-300"
            />
            
            <p className="text-base text-gray-700 leading-relaxed px-4 mb-4 font-medium">
              BioImage.IO -- a collaborative effort to bring AI models to the bioimaging community, powered by the AI4Life consortium
            </p>
            
            <p className="text-sm text-gray-600 leading-relaxed px-4">
              AI4Life receives funding from the European Union's Horizon Europe research and innovation programme under grant agreement number 101057970. Views and opinions expressed are however those of the author(s) only and do not necessarily reflect those of the European Union or the European Research Council Executive Agency. Neither the European Union nor the granting authority can be held responsible for them.
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
                This is the new BioImage Model Zoo website released on June 30th, 2025. You can find the legacy website archived at{' '}
                <a 
                  href="https://archive.bioimage.io" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-medium hover:underline transition-all duration-300"
                >
                  https://archive.bioimage.io
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer; 