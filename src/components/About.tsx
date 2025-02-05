import React from 'react';

const About: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <h1 className="text-4xl font-bold mb-8 text-center text-gray-900">About BioImage.IO</h1>
      
      <section className="mb-12 bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-800">Our Mission</h2>
        <p className="text-gray-600 leading-relaxed">
          BioImage.IO is a collaborative platform bringing AI models to the bioimaging community. 
          As part of the AI4Life consortium, we provide a community-driven, open resource for 
          sharing standardized AI models for bioimage analysis.
        </p>
      </section>

      <section className="mb-12 bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-800">What We Offer</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            'Advanced AI models accessible in one click',
            'Standardized model sharing platform',
            'Community-driven resource development',
            'Integration with bioimaging tools and workflows'
          ].map((item, index) => (
            <li key={index} className="flex items-start space-x-3">
              <svg className="h-6 w-6 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-gray-600">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-12 bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800">Get Involved</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a href="/#/upload" 
             target="_blank" 
             rel="noopener noreferrer"
             className="flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition duration-150 ease-in-out">
            Contribute Models
          </a>
          <a href="#community-partners" 
             className="flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition duration-150 ease-in-out">
            Join Community Partners
          </a>
          <a href="https://forum.image.sc/tag/bioimageio" 
             target="_blank" 
             rel="noopener noreferrer"
             className="flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition duration-150 ease-in-out">
            Join Discussions
          </a>
        </div>
      </section>

      <section className="mb-12 bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-800">Funding & Support</h2>
        <p className="text-gray-600 leading-relaxed mb-6">
          BioImage.IO receives funding through the AI4Life project with support from the European Union's 
          Horizon Europe research and innovation programme under grant agreement number 101057970.
        </p>
        <div className="flex flex-wrap items-center gap-6 mt-4">
          <img 
            src="/img/AI4Life-logo-giraffe.png" 
            alt="AI4Life Logo" 
            className="h-16 object-contain"
          />
          <img 
            src="/img/EuropeanFlag-Funded by the EU-POS.jpg" 
            alt="EU Flag" 
            className="h-16 object-contain"
          />
        </div>
      </section>
    </div>
  );
};

export default About; 