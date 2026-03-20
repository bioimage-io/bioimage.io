import React from 'react';

interface ColabGuideProps {
  supportedFileTypes: string[];
  onClose: () => void;
}

const ColabGuide: React.FC<ColabGuideProps> = ({ supportedFileTypes, onClose }) => {
  const formatList = supportedFileTypes.map(ext => ext.replace('.', '').toUpperCase()).join(', ');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-lg max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Getting Started with BioImage.IO Colab</h3>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Introduction */}
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
            <p className="text-gray-700 leading-relaxed">
              <strong className="text-purple-900">BioImage.IO Colab</strong> is an interactive, browser-based annotation tool for collaborative
              image annotation. All processing happens in your browser using Python via WebAssembly, ensuring your data remains
              private and secure.
            </p>
          </div>

          {/* Workflow Steps */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-800 mb-3">How It Works:</h4>

            {/* Step 1 */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                1
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Start an Annotation Session</h5>
                <p className="text-sm text-gray-600">
                  Click <strong>"Start Annotation Session"</strong> to begin. You'll have three options:
                </p>
                <ul className="text-sm text-gray-600 list-disc list-inside ml-4 mt-2 space-y-1">
                  <li><strong>Mount Local Folder</strong> - Select a folder on your computer with images. Files stay local and are accessed directly through your browser. Annotated images are uploaded automatically to the cloud.</li>
                  <li><strong>Upload to Cloud</strong> - Upload all images to the cloud before starting. Supports drag & drop of files and folders.</li>
                  <li><strong>Resume Existing Session</strong> - Continue working on a previously created session.</li>
                </ul>
                <p className="text-sm text-gray-600 mt-2">
                  Supported formats: <strong>{formatList}</strong>
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  Don't have images? <a href="https://github.com/bioimage-io/bioimageio-colab/releases/download/v0.1/hpa-dataset-v2-98-rgb.zip" className="text-purple-600 hover:text-purple-800 underline" target="_blank" rel="noopener noreferrer">Download an example dataset</a> to try it out.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                2
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Share and Collaborate</h5>
                <p className="text-sm text-gray-600">
                  Once your session is created, click <strong>"Share Annotation URL"</strong> to get a shareable link.
                  Collaborators can use this link to annotate images using Kaibu, and annotations are automatically saved
                  to the cloud artifact.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                3
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Train AI Model</h5>
                <p className="text-sm text-gray-600">
                  Once you have annotated images, click <strong>"Train AI Model"</strong> to fine-tune a Cellpose-SAM model
                  on your annotations. The trained model can be exported and downloaded as a ZIP file.
                </p>
              </div>
            </div>
          </div>

          {/* Additional Features */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-green-800 mb-1">Additional Features:</p>
                <ul className="text-sm text-green-700 space-y-1">
                  <li>• <strong>Upload All to Cloud</strong> - For local sessions, convert to cloud mode by uploading all images at once</li>
                  <li>• <strong>Download Annotations</strong> - Download annotated images as a ZIP file</li>
                  <li>• <strong>View Progress</strong> - Track annotation progress with real-time statistics</li>
                  <li>• <strong>Delete Session</strong> - Remove cloud artifacts when you're done</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Important Notes */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className="font-semibold text-amber-800 mb-1">Important Notes:</p>
                <ul className="text-sm text-amber-700 space-y-1">
                  <li>• You must be logged in to create and share annotation sessions</li>
                  <li>• Annotations are stored securely in the cloud (Hypha Artifacts)</li>
                  <li>• For local folder mode: Keep this browser tab open while collaborators are annotating</li>
                  <li>• The first time you create a session, Python packages will be downloaded (this may take a few moments)</li>
                  <li>• Local folder mounting works best in Chromium-based browsers (Chrome, Edge, Brave)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* What is Hypha */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-blue-800 mb-1">What is Hypha?</p>
                <p className="text-sm text-blue-700">
                  Hypha is a platform for sharing computational tools and services. When you create a session,
                  you're registering your browser as a service provider that others can connect to for collaborative annotation.
                  Annotations are stored in cloud artifacts for persistence and sharing.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all shadow-sm hover:shadow-md font-medium"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColabGuide;
