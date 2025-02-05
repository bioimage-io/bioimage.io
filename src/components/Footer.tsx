import React from 'react';

const footerLinks = [
  {
    label: "Ask a question on image.sc forum",
    href: "https://forum.image.sc/tag/bioimageio",
    icon: "/img/imagesc-logo.png",
    caption: "Question"
  },
  {
    label: "Give us some feedback through this Google Form",
    href: "https://forms.gle/CA1yK4pUKMqBPtso8",
    icon: "/img/feedback-icon.png",
    caption: "Feedback Form"
  },
  {
    label: "Github Repository",
    href: "https://github.com/bioimage-io/bioimage.io",
    icon: "/img/github.png",
    caption: "Source Code"
  },
  {
    label: "Send us a message",
    href: "https://oeway.typeform.com/to/K3j2tJt7",
    icon: "/img/contact.png",
    caption: "Contact Us"
  },
  {
    label: "We receive funding through the AI4Life project with support from the European Union's Horizon Europe research and innovation programme under grant agreement number 101057970",
    href: "https://ai4life.eurobioimaging.eu/",
    icon: "/img/AI4Life-logo-giraffe.png",
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
    <footer className="w-full py-8 px-4 mt-16 bg-gray-50 border-t border-gray-200">
      <div className="max-w-7xl mx-auto">
        {/* Links Section */}
        <div className="flex flex-wrap justify-center items-start gap-4 mb-8">
          {footerLinks.map((link, index) => (
            <div key={index} className="w-[150px] text-center">
              <div className="group relative" title={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block hover:opacity-80 transition-opacity"
                >
                  <figure className="flex flex-col items-center">
                    <img
                      src={link.icon}
                      alt={link.caption}
                      className="h-[45px] w-auto object-contain mb-2"
                    />
                    <figcaption className="text-sm text-gray-600 hidden md:block">
                      {link.caption}
                    </figcaption>
                  </figure>
                </a>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-2 bg-gray-900 text-white text-xs rounded-md shadow-lg whitespace-nowrap z-10">
                  {link.label}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Content Section */}
        <div className="text-center space-y-6 max-w-4xl mx-auto">
          <div className="border-t border-gray-200 pt-6">
            <p className="text-base text-gray-700 font-medium mb-4">
              BioImage.IO -- a collaborative effort to bring AI models to the bioimaging community, powered by the AI4Life consortium
            </p>
            
            <img
              src="/img/EuropeanFlag-Funded by the EU-POS.jpg"
              alt="Funded by the European Union"
              className="w-[300px] mx-auto mb-4"
            />
            
            <p className="text-sm text-gray-600 leading-relaxed px-4">
              AI4Life receives funding from the European Union's Horizon Europe research and innovation programme under grant agreement number 101057970. Views and opinions expressed are however those of the author(s) only and do not necessarily reflect those of the European Union or the European Research Council Executive Agency. Neither the European Union nor the granting authority can be held responsible for them.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer; 