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
              <strong className="text-purple-900">BioImage.IO Colab</strong> is a browser-based tool for collaborative
              image annotation and Cellpose-SAM fine-tuning. Annotation runs entirely in your browser using Python via
              WebAssembly, and images, masks, and models are shared through Hypha Cloud artifacts.
            </p>
          </div>

          {/* Workflow sections */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-800 mb-3">How It Works</h4>

            {/* Datasets */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                1
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Create a Dataset</h5>
                <p className="text-sm text-gray-600">
                  From the Colab landing page, either <strong>mount a local folder</strong> of images (files stay on
                  your machine and are read directly by your browser) or <strong>create a cloud dataset</strong> and
                  upload images to it. Both paths land you on the dataset overview page.
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  Supported formats: <strong>{formatList}</strong>
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  Don't have images? <a href="https://github.com/bioimage-io/bioimageio-colab/releases/download/v0.1/hpa-dataset-v2-98-rgb.zip" className="text-purple-600 hover:text-purple-800 underline" target="_blank" rel="noopener noreferrer">Download an example dataset</a> to try it out.
                </p>
              </div>
            </div>

            {/* Labels */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                2
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Create Labels</h5>
                <p className="text-sm text-gray-600">
                  A dataset can hold one or more labels (Cell, Nucleus, whatever your task needs). Each label is its
                  own independent set of masks, so the same images can be annotated for several targets at once.
                  Create and manage labels from the Labels box on the dataset overview page.
                </p>
              </div>
            </div>

            {/* Sharing */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                3
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Share the Dataset</h5>
                <p className="text-sm text-gray-600">
                  Every dataset has one owner, and any number of managers and annotators. Managers can manage labels
                  and sharing, annotators can only annotate. Use the <strong>Share</strong> button to grant roles by
                  email, make the dataset public, or approve access requests from people who opened the link without
                  a role yet.
                </p>
              </div>
            </div>

            {/* Uploading images */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                4
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Upload Images</h5>
                <p className="text-sm text-gray-600">
                  With a local folder mounted, images upload to the cloud one at a time as you open or annotate them,
                  so you only pay the upload cost for images you actually work on. Use <strong>Upload all</strong> in
                  the image list to upload everything at once instead.
                </p>
              </div>
            </div>

            {/* Annotating */}
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg flex items-center justify-center font-bold mr-3 text-sm">
                5
              </div>
              <div>
                <h5 className="font-semibold text-gray-800 mb-1">Annotate</h5>
                <p className="text-sm text-gray-600">
                  Open the annotator from a label's <strong>Annotate</strong> button, or share the annotation URL so
                  collaborators can jump straight into a label without visiting the overview page first. Manual
                  drawing tools are available immediately. The AI Box needs a per-image embedding and a decoder
                  model, so it shows a loading state until both are ready, usually a few seconds after the image
                  appears.
                </p>
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
                <p className="font-semibold text-amber-800 mb-1">Important Notes</p>
                <ul className="text-sm text-amber-700 space-y-1">
                  <li>• You must be logged in to create datasets, share them, or annotate.</li>
                  <li>• Annotations and images are stored in Hypha Cloud artifacts, not on your machine.</li>
                  <li>• For a mounted local folder, keep this browser tab open while collaborators are annotating.</li>
                  <li>• The first time you mount a folder, Python packages are downloaded, which can take a moment.</li>
                  <li>• Local folder mounting works best in Chromium-based browsers (Chrome, Edge, Brave).</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Fine-tuning */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-blue-800 mb-1">Fine-tuning</p>
                <p className="text-sm text-blue-700">
                  Once a label has enough annotated images, click <strong>Finetune</strong> to train a Cellpose-SAM
                  model on them. The trained model becomes available for that label's AI Box, so future predictions
                  improve as you annotate more.
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
