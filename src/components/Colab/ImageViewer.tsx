import React, { useState, useEffect } from 'react';

interface ImageViewerProps {
  imageList: string[];
  annotationsList: string[];
  dataArtifactId: string | null;
  label: string;
  artifactManager: any;
  serverUrl: string;
  isLoadingImages: boolean;
  isLoadingAnnotations: boolean;
}

const ImageViewer: React.FC<ImageViewerProps> = ({
  imageList,
  annotationsList,
  dataArtifactId,
  label,
  artifactManager,
  serverUrl,
  isLoadingImages,
  isLoadingAnnotations,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'raw' | 'annotated'>('raw');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [annotationUrl, setAnnotationUrl] = useState<string>('');

  // Check if an image is annotated
  const isAnnotated = (imageName: string) => {
    const baseName = imageName.substring(0, imageName.lastIndexOf('.')) || imageName;
    return annotationsList.some(ann => {
      const annBaseName = ann.substring(0, ann.lastIndexOf('.')) || ann;
      return annBaseName === baseName;
    });
  };

  // Load image URLs when selected
  useEffect(() => {
    if (!selectedImage || !dataArtifactId) {
      setImageUrl('');
      setAnnotationUrl('');
      return;
    }

    const loadImageUrls = async () => {
      try {
        const artifactAlias = dataArtifactId.split('/').pop();
        const baseName = selectedImage.substring(0, selectedImage.lastIndexOf('.')) || selectedImage;

        // Raw image URL
        const rawUrl = `${serverUrl}/bioimage-io/artifacts/${artifactAlias}/files/input_images/${baseName}.png`;
        setImageUrl(rawUrl);

        // Annotation URL (if exists)
        if (isAnnotated(selectedImage)) {
          const maskFolder = label ? `masks_${label}` : 'annotations';
          const annUrl = `${serverUrl}/bioimage-io/artifacts/${artifactAlias}/files/${maskFolder}/${baseName}.png`;
          setAnnotationUrl(annUrl);
        } else {
          setAnnotationUrl('');
        }
      } catch (error) {
        console.error('Error loading image URLs:', error);
      }
    };

    loadImageUrls();
  }, [selectedImage, dataArtifactId, label, serverUrl, annotationsList]);

  // Calculate statistics
  const totalImages = imageList.length;
  const annotatedImages = imageList.filter(img => isAnnotated(img)).length;
  const progress = totalImages > 0 ? Math.round((annotatedImages / totalImages) * 100) : 0;

  const renderDashboard = () => (
    <div className="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-2xl p-8">
        <div className="text-center mb-8">
          <svg className="w-20 h-20 mx-auto mb-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <h3 className="text-2xl font-bold text-gray-800 mb-2">Annotation Progress</h3>
          <p className="text-gray-600">Select an image from the sidebar to view and annotate</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Total Images</span>
              <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-3xl font-bold text-gray-900">{totalImages}</div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Annotated</span>
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-3xl font-bold text-gray-900">{annotatedImages}</div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Remaining</span>
              <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-3xl font-bold text-gray-900">{totalImages - annotatedImages}</div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">Completion Progress</span>
            <span className="text-sm font-semibold text-purple-600">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          {totalImages > 0 && (
            <p className="text-xs text-gray-500 mt-2 text-center">
              {annotatedImages} of {totalImages} images annotated
            </p>
          )}
        </div>

        {label && (
          <div className="mt-6 text-center">
            <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-purple-100 text-purple-800">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Label: {label}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  const renderImagePreview = () => {
    if (!selectedImage) return null;

    const hasAnnotation = isAnnotated(selectedImage);

    return (
      <div className="flex flex-col h-full">
        {/* Tabs */}
        {hasAnnotation && (
          <div className="flex border-b border-gray-200 bg-white px-4">
            <button
              onClick={() => setViewMode('raw')}
              className={`px-4 py-3 font-medium text-sm transition-colors ${
                viewMode === 'raw'
                  ? 'border-b-2 border-purple-500 text-purple-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Raw Image
            </button>
            <button
              onClick={() => setViewMode('annotated')}
              className={`px-4 py-3 font-medium text-sm transition-colors ${
                viewMode === 'annotated'
                  ? 'border-b-2 border-purple-500 text-purple-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Annotated
            </button>
          </div>
        )}

        {/* Image Display */}
        <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 overflow-auto">
          {viewMode === 'raw' && imageUrl ? (
            <img
              src={imageUrl}
              alt={selectedImage}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              onError={(e) => {
                console.error('Failed to load image:', imageUrl);
                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5JbWFnZSBub3QgYXZhaWxhYmxlPC90ZXh0Pjwvc3ZnPg==';
              }}
            />
          ) : viewMode === 'annotated' && annotationUrl ? (
            <img
              src={annotationUrl}
              alt={`${selectedImage} (annotated)`}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              onError={(e) => {
                console.error('Failed to load annotation:', annotationUrl);
                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5Bbm5vdGF0aW9uIG5vdCBhdmFpbGFibGU8L3RleHQ+PC9zdmc+';
              }}
            />
          ) : (
            <div className="text-center text-gray-400">
              <svg className="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p>Loading image...</p>
            </div>
          )}
        </div>

        {/* Image Info */}
        <div className="bg-white border-t border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{selectedImage}</p>
              <p className="text-xs text-gray-500 mt-1">
                {hasAnnotation ? (
                  <span className="inline-flex items-center text-green-600">
                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Annotated
                  </span>
                ) : (
                  <span className="text-gray-500">Not annotated</span>
                )}
              </p>
            </div>
            {hasAnnotation && (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Completed
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Sidebar - File List */}
      <div className="w-80 border-r border-gray-200 flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200 bg-white">
          <h3 className="text-lg font-semibold text-gray-800">Images</h3>
          <p className="text-xs text-gray-500 mt-1">
            {imageList.length} total · {annotatedImages} annotated
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoadingImages ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : imageList.length === 0 ? (
            <div className="text-center py-8 px-4">
              <svg className="w-12 h-12 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-gray-600">No images found</p>
              <p className="text-xs text-gray-500 mt-1">Start a session to upload images</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {imageList.map((image) => {
                const annotated = isAnnotated(image);
                const isSelected = selectedImage === image;

                return (
                  <button
                    key={image}
                    onClick={() => setSelectedImage(image)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? 'bg-purple-50 border-l-4 border-purple-500'
                        : 'hover:bg-gray-100 border-l-4 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${
                          isSelected ? 'text-purple-900' : 'text-gray-900'
                        }`}>
                          {image}
                        </p>
                      </div>
                      {annotated && (
                        <span className="ml-2 flex-shrink-0">
                          <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main Area - Preview or Dashboard */}
      <div className="flex-1 flex flex-col">
        {selectedImage ? renderImagePreview() : renderDashboard()}
      </div>
    </div>
  );
};

export default ImageViewer;
