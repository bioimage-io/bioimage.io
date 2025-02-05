import React, { useState, useRef } from 'react';

interface Partner {
  name: string;
  icon: string;
  link: string;
}


const partners: Partner[] = [
  {
    name: 'ZeroCostDL4Mic',
    icon: 'https://raw.githubusercontent.com/HenriquesLab/ZeroCostDL4Mic/master/Wiki_files/ZeroCostLogo.png',
    link: 'https://github.com/HenriquesLab/ZeroCostDL4Mic'
  },
  {
    name: 'DeepImageJ',
    icon: 'https://raw.githubusercontent.com/deepimagej/models/master/logos/icon.png',
    link: 'https://deepimagej.github.io/'
  },
  {
    name: 'Fiji',
    icon: 'https://fiji.sc/site/logo.png',
    link: 'https://fiji.sc'
  },
  {
    name: 'ImJoy',
    icon: 'https://imjoy.io/static/img/imjoy-icon.svg',
    link: 'https://imjoy.io'
  },
  {
    name: 'ilastik',
    icon: 'https://raw.githubusercontent.com/ilastik/bioimage-io-resources/main/image/ilastik-fist-icon.png',
    link: 'https://www.ilastik.org'
  },
  {
    name: 'HPA',
    icon: 'https://raw.githubusercontent.com/bioimage-io/tfjs-bioimage-io/master/apps/hpa-logo.gif',
    link: 'https://www.proteinatlas.org'
  },
  {
    name: 'Icy',
    icon: 'https://raw.githubusercontent.com/Icy-imaging/icy-bioimage-io/main/icy_logo.svg',
    link: 'http://icy.bioimageanalysis.org'
  },
  {
    name: 'QuPath',
    icon: 'https://raw.githubusercontent.com/qupath/qupath-bioimage-io/main/logos/QuPath_256.png',
    link: 'https://qupath.github.io'
  },
  {
    name: 'StarDist',
    icon: 'https://raw.githubusercontent.com/stardist/stardist-bioimage-io/main/logos/stardist_256.png',
    link: 'https://github.com/stardist/stardist'
  },
  {
    name: 'BiaPy',
    icon: 'https://raw.githubusercontent.com/BiaPyX/BiaPy-bioimage-io/main/logos/BiaPy_256.png',
    link: 'https://github.com/BiaPyX/BiaPy'
  },
  {
    name: 'DL4MicEverywhere',
    icon: 'https://raw.githubusercontent.com/HenriquesLab/DL4MicEverywhere-bioimage-io/main/logo/dl4miceverywhere-logo-small.png',
    link: 'https://github.com/HenriquesLab/DL4MicEverywhere'
  },
  {
    name: 'SpotMAX',
    icon: 'https://raw.githubusercontent.com/SchmollerLab/SpotMAX/refs/heads/main/spotmax/resources/spotMAX_logo.svg',
    link: 'https://github.com/SchmollerLab/SpotMAX'
  },
  {
    name: 'CAREamics',
    icon: 'https://raw.githubusercontent.com/CAREamics/.github/refs/heads/main/profile/images/logo_careamics_128.png',
    link: 'https://github.com/CAREamics'
  }
];

const PartnerScroll: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative max-w-[1400px] mx-auto px-4 mt-8">
      <h2 className="text-2xl font-bold text-center mb-6">Community Partners</h2>
      {showLeftArrow && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-white shadow-lg rounded-full p-2"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      
      <div
        ref={scrollRef}
        className="flex overflow-x-auto scrollbar-hide space-x-4 py-4"
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          setShowLeftArrow(target.scrollLeft > 0);
          setShowRightArrow(
            target.scrollLeft < target.scrollWidth - target.clientWidth
          );
        }}
      >
        {partners.map((partner) => (
          <a
            key={partner.name}
            href={partner.link}
            className="flex flex-col items-center space-y-2 min-w-[100px]"
          >
            <img src={partner.icon} alt={partner.name} className="w-12 h-12" />
            <span className="text-sm text-gray-600">{partner.name}</span>
          </a>
        ))}
      </div>

      {showRightArrow && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-white shadow-lg rounded-full p-2"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default PartnerScroll; 