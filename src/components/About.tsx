import React from 'react';

const About: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">About BioImage.IO</h1>
      
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Our Mission</h2>
        <p className="text-gray-700 mb-4">
          BioImage.IO is a collaborative platform bringing AI models to the bioimaging community. 
          As part of the AI4Life consortium, we provide a community-driven, open resource for 
          sharing standardized AI models for bioimage analysis.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">What We Offer</h2>
        <ul className="list-disc list-inside text-gray-700 space-y-2">
          <li>Advanced AI models accessible in one click</li>
          <li>Standardized model sharing platform</li>
          <li>Community-driven resource development</li>
          <li>Integration with bioimaging tools and workflows</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Get Involved</h2>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <a href="https://bioimageio-uploader.netlify.app/" 
               target="_blank" 
               rel="noopener noreferrer"
               className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Contribute Models
            </a>
            <a href="#community-partners" 
               className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Join Community Partners
            </a>
            <a href="https://forum.image.sc/tag/bioimageio" 
               target="_blank" 
               rel="noopener noreferrer"
               className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Join Discussions
            </a>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Funding & Support</h2>
        <p className="text-gray-700 mb-4">
          BioImage.IO receives funding through the AI4Life project with support from the European Union's 
          Horizon Europe research and innovation programme under grant agreement number 101057970.
        </p>
        <div className="flex items-center gap-4 mt-4">
          <img 
            src="/img/AI4Life-logo-giraffe.png" 
            alt="AI4Life Logo" 
            className="h-14"
          />
          <img 
            src="/img/EuropeanFlag-Funded by the EU-POS.jpg" 
            alt="EU Flag" 
            className="h-14"
          />
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Contact & Resources</h2>
        <div className="flex flex-wrap gap-6">
          <a href="https://forum.image.sc/tag/bioimageio" 
             target="_blank" 
             rel="noopener noreferrer"
             className="flex flex-col items-center">
            <img src="/img/imagesc-logo.png" alt="Image.sc Forum" className="h-14 mb-2" />
            <span>Ask Questions</span>
          </a>
          <a href="https://github.com/bioimage-io/bioimage.io" 
             target="_blank" 
             rel="noopener noreferrer"
             className="flex flex-col items-center">
            <img src="/img/github.png" alt="GitHub" className="h-14 mb-2" />
            <span>Source Code</span>
          </a>
          <a href="https://forms.gle/CA1yK4pUKMqBPtso8" 
             target="_blank" 
             rel="noopener noreferrer"
             className="flex flex-col items-center">
            <img src="/img/feedback-icon.png" alt="Feedback" className="h-14 mb-2" />
            <span>Give Feedback</span>
          </a>
        </div>
      </section>
    </div>
  );
};

export default About; 