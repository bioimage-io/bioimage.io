import React, { useState } from 'react';

interface ColabGuideProps {
  supportedFileTypes: string[];
}

const ColabGuide: React.FC<ColabGuideProps> = ({ supportedFileTypes }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatList = supportedFileTypes.map(ext => ext.replace('.', '').toUpperCase()).join(', ');

  return (
    <div>
      <div
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 className="text-xl font-semibold text-gray-800 flex items-center">
          <svg className="w-6 h-6 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Getting Started with BioImage.IO Colab
        </h3>
        <svg
          className={`w-5 h-5 text-gray-600 transition-transform ${isExpanded ? 'transform rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isExpanded && (
        <div className="mt-6 space-y-4 text-gray-700">
          <p className="leading-relaxed">
            <strong>BioImage.IO Colab</strong> is an interactive, browser-based annotation tool designed for collaborative
            image annotation. All processing happens in your browser using Python via WebAssembly, ensuring your data remains
            private and secure.
          </p>

          <div className="space-y-3">
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg flex items-center justify-center font-bold mr-3">
                1
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 mb-1">Mount a Local Folder</h4>
                <p className="text-sm text-gray-600">
                  Select a folder containing images you want to annotate. The images stay on your computer and are
                  accessed directly through your browser. Supported formats: {formatList}.
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg flex items-center justify-center font-bold mr-3">
                2
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 mb-1">Create an Annotation Session</h4>
                <p className="text-sm text-gray-600">
                  Once images are loaded, create a session. This will:
                </p>
                <ul className="text-sm text-gray-600 list-disc list-inside ml-4 mt-1">
                  <li>Start a Python kernel in your browser</li>
                  <li>Create a cloud artifact to store your annotations</li>
                  <li>Register a service with Hypha for collaborative access</li>
                  <li>Generate a shareable annotation URL</li>
                </ul>
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg flex items-center justify-center font-bold mr-3">
                3
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 mb-1">Share and Collaborate</h4>
                <p className="text-sm text-gray-600">
                  Share the generated URL with collaborators. They can annotate images using Kaibu, and annotations
                  will be automatically saved to the cloud artifact.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className="font-semibold text-amber-800 mb-1">Important Notes:</p>
                <ul className="text-sm text-amber-700 space-y-1">
                  <li>• Keep this browser tab open while collaborators are annotating</li>
                  <li>• Annotations are stored securely in the cloud (Hypha Artifacts)</li>
                  <li>• The first time you create a session, Python packages will be downloaded (this may take a few moments)</li>
                  <li>• You must be logged in to create and share annotation sessions</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-blue-800 mb-1">What is Hypha?</p>
                <p className="text-sm text-blue-700">
                  Hypha is a platform for sharing computational tools and services. When you create a session,
                  you're registering your browser as a service provider that others can connect to for collaborative annotation.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColabGuide;
