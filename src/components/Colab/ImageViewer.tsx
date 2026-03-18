import React, { useState, useEffect } from 'react';

const ColorizedMask = ({
  src,
  alt,
  className,
  onError,
}: {
  src: string;
  alt: string;
  className: string;
  onError: (e: any) => void;
}) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadAndColorize = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!active) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(img, 0, 0);
        
        let imgData;
        try {
          imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (e) {
          console.warn("CORS error getting image data, using raw image", e);
          setDataUrl(src); // fallback to raw image
          return;
        }

        const data = imgData.data;

        // BioImage.IO colorful scheme
        const palette = [
          [37, 99, 235],    // blue-600
          [147, 51, 234],   // purple-600
          [219, 39, 119],   // fuchsia-600
          [22, 163, 74],    // emerald-600
          [234, 88, 12],    // orange-600
          [220, 38, 38],    // red-600
          [202, 138, 4],    // yellow-600
          [6, 182, 212],    // cyan-500
          [139, 92, 246],   // violet-500
          [244, 63, 94],    // rose-500
        ];

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          // As encoded: R=high byte, G=low byte
          const labelId = (r << 8) | g;

          if (labelId === 0) {
            // Background in black
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 255;
          } else {
            // Colorful masks
            const color = palette[(labelId - 1) % palette.length];
            data[i] = color[0];
            data[i + 1] = color[1];
            data[i + 2] = color[2];
            data[i + 3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        setDataUrl(canvas.toDataURL('image/png'));
      };
      img.onerror = onError;
      img.src = src;
    };

    loadAndColorize();

    return () => {
      active = false;
    };
  }, [src, onError]);

  if (!dataUrl) {
    return (
      <div className={`flex items-center justify-center bg-black/5 rounded-lg ${className}`} style={{ minHeight: '300px' }}>
        <svg className="w-8 h-8 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  return <img src={dataUrl} alt={alt} className={className} />;
};

interface ImageViewerProps {
  imageList: string[];
  annotationsList: string[];
  dataArtifactId: string | null;
  label: string;
  artifactManager: any;
  serverUrl: string;
  isLoadingImages: boolean;
  isLoadingAnnotations: boolean;
  sessionName?: string;
  dataSourceType?: 'local' | 'upload' | 'resume';
  imageFolderHandle?: FileSystemDirectoryHandle | null;
  executeCode?: ((code: string, callbacks?: any) => Promise<void>) | null;
  annotationURL?: string;
  server?: any;
  onDelete?: () => void;
  onUploadAll?: () => Promise<void>;
  onRefresh?: () => void;
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
  sessionName,
  dataSourceType = 'upload',
  imageFolderHandle,
  executeCode,
  annotationURL,
  server,
  onDelete,
  onUploadAll,
  onRefresh,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'raw' | 'annotated'>('raw');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [annotationUrl, setAnnotationUrl] = useState<string>('');
  const [showDashboard, setShowDashboard] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [cloudImages, setCloudImages] = useState<Set<string>>(new Set());
  const [deletedAnnotations, setDeletedAnnotations] = useState<Set<string>>(new Set());

  // Periodically fetch cloud images
  useEffect(() => {
    if (!dataArtifactId || !artifactManager) return;
    
    let isSubscribed = true;
    const fetchCloudImages = async () => {
      try {
        const files = await artifactManager.list_files({
          artifact_id: dataArtifactId,
          dir_path: 'input_images',
          _rkwargs: true
        });
        if (isSubscribed) {
          const fileNames = new Set<string>(files.map((f: any) => f.name));
          setCloudImages(fileNames);
        }
      } catch (e) {
        // Ignore errors silently for now polling could fail occasionally
      }
    };
    
    fetchCloudImages();
    const intervalId = setInterval(fetchCloudImages, 5000);
    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
    };
  }, [dataArtifactId, artifactManager]);

  const handleDeleteCloudImage = async (image: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!dataArtifactId || !artifactManager) return;
    
    const hasMasks = isAnnotated(image);
    if (hasMasks) {
      if (!window.confirm(`Warning: The image ${image} has annotation masks. If you remove this file, all annotation masks for it will be deleted as well. Do you want to proceed?`)) {
        return;
      }
    }
    
    try {
      await artifactManager.remove_file({
        artifact_id: dataArtifactId,
        file_path: `input_images/${image}`,
        _rkwargs: true
      });
      
      if (hasMasks) {
        const maskFolder = label ? `masks_${label}` : 'annotations';
        const baseName = image.substring(0, image.lastIndexOf('.')) || image;
        await artifactManager.remove_file({
          artifact_id: dataArtifactId,
          file_path: `${maskFolder}/${baseName}.png`,
          _rkwargs: true
        });
        
        setDeletedAnnotations(prev => {
          const next = new Set(prev);
          next.add(baseName);
          return next;
        });
      }
      
      setCloudImages(prev => {
        const next = new Set(prev);
        next.delete(image);
        return next;
      });
      
      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to delete cloud file(s)', error);
      alert('Failed to delete file(s) from artifact manager');
    }
  };

  // Check if an image is annotated
  const isAnnotated = (imageName: string) => {
    const baseName = imageName.substring(0, imageName.lastIndexOf('.')) || imageName;
    if (deletedAnnotations.has(baseName)) return false;
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
        const annotated = isAnnotated(selectedImage);

        // For raw image: check if it's available in artifact or needs to be read from local
        const imageInArtifact = cloudImages.has(selectedImage);

        if (imageInArtifact) {
          // Raw image from artifact
          const rawUrl = `${serverUrl}/bioimage-io/artifacts/${artifactAlias}/files/input_images/${baseName}.png`;
          setImageUrl(rawUrl);
        } else {
          let localImageLoaded = false;

          // Try to read directly from local filesystem if handle is available
          if (imageFolderHandle) {
            try {
              const fileHandle = await (imageFolderHandle as any).getFileHandle(selectedImage);
              const file = await fileHandle.getFile();
              setImageUrl(URL.createObjectURL(file));
              localImageLoaded = true;
            } catch (err) {
              console.warn('Failed to read image directly from local folder, falling back to Hypha service:', err);
            }
          }

          // Raw image needs to be read from local folder via Hypha service if direct local check failed
          if (!localImageLoaded) {
            if (annotationURL && server) {
              try {
                // Extract service ID from annotation URL
                let serviceId = null;
                const serviceIdMatch = annotationURL.match(/image_provider_id=([^&]+)/);
                if (serviceIdMatch) {
                  serviceId = decodeURIComponent(serviceIdMatch[1]);
                } else {
                  const configMatch = annotationURL.match(/config=([^&]+)/);
                  if (configMatch) {
                    try {
                      const config = JSON.parse(decodeURIComponent(configMatch[1]));
                      serviceId = config.imageProviderId;
                    } catch (e) {
                      console.error('Could not parse config JSON:', e);
                    }
                  }
                }

                if (serviceId) {
                  // Get the service
                  const imageService = await server.getService(serviceId);

                  // Call get_local_image_base64 with proper kwargs
                  const base64Data = await imageService.get_local_image_base64({
                    image_name: selectedImage,
                    _rkwargs: true
                  });

                  setImageUrl(`data:image/png;base64,${base64Data}`);
                } else {
                  console.error('Service ID not found in annotation URL');
                  setImageUrl('');
                }
              } catch (error) {
                console.error('Error reading local image via Hypha service:', error);
                setImageUrl('');
              }
            } else {
              console.error('Cannot read local image: annotation URL or server not available');
              setImageUrl('');
            }
          }
        }

        // Annotation URL (if exists) - always from artifact
        if (annotated) {
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
  }, [selectedImage, dataArtifactId, label, serverUrl, annotationsList, dataSourceType, imageFolderHandle, executeCode, annotationURL, server, cloudImages]);

  // Calculate statistics
  const totalImages = imageList.length;
  const annotatedImages = imageList.filter(img => isAnnotated(img)).length;
  const progress = totalImages > 0 ? Math.round((annotatedImages / totalImages) * 100) : 0;

  const renderDashboard = () => (
    <div className="flex items-center justify-center h-full bg-gradient-to-br from-purple-50/30 via-pink-50/20 to-blue-50/30">
      <div className="max-w-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center shadow-lg">
            <svg className="w-12 h-12 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">Annotation Progress</h3>
          <p className="text-gray-600">Select an image from the sidebar to view and annotate</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-6 border border-blue-200/60 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Total Images</span>
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <div className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{totalImages}</div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-6 border border-green-200/60 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Annotated</span>
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <div className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">{annotatedImages}</div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-6 border border-purple-200/60 hover:shadow-lg transition-shadow">
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
            <ColorizedMask
              src={annotationUrl}
              alt={`${selectedImage} (annotated)`}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              onError={(e) => {
                console.error('Failed to load annotation:', annotationUrl);
                const target = e.target || e;
                if (target && typeof target === 'object' && 'src' in target) {
                  (target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5Bbm5vdGF0aW9uIG5vdCBhdmFpbGFibGU8L3RleHQ+PC9zdmc+';
                }
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

  const displayName = sessionName || 'Annotation Session';
  const hasUnuploadedImages = imageList.some(img => !cloudImages.has(img));

  return (
    <div className="flex h-full bg-white/80 backdrop-blur-sm rounded-2xl shadow-md border border-gray-200/60 overflow-hidden">
      {/* Sidebar - File List */}
      <div className="w-80 border-r border-gray-200/60 flex flex-col bg-gradient-to-b from-gray-50 to-purple-50/20">
        <div className="border-b border-gray-200 bg-white">
          <button
            onClick={() => setShowDashboard(!showDashboard)}
            className="p-3 hover:bg-gray-50 transition-colors text-left w-full"
          >
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-800 truncate flex-1">{displayName}</h3>
              <svg
                className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showDashboard ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
              {label && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">
                  <svg className="w-2.5 h-2.5 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {label}
                </span>
              )}
              <span className="text-gray-500">
                {imageList.length} total · {annotatedImages} annotated
              </span>
            </div>
            {dataArtifactId && (
              <div className="text-[9px] text-gray-400 mt-1 font-mono truncate">
                {dataArtifactId}
              </div>
            )}
          </button>

          {/* Action buttons */}
          <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
            {dataSourceType === 'local' && onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isLoadingImages}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center border shadow-sm ${
                  isLoadingImages
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 hover:from-purple-100 hover:to-pink-100 border-purple-200 hover:shadow-md'
                }`}
                title="Refresh local file list"
              >
                <svg className={`w-3.5 h-3.5 mr-1.5 ${isLoadingImages ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isLoadingImages ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
            {hasUnuploadedImages && onUploadAll && (
              <button
                onClick={async () => {
                  setIsUploading(true);
                  try {
                    await onUploadAll();
                  } finally {
                    setIsUploading(false);
                  }
                }}
                disabled={isUploading}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center border shadow-sm ${
                  isUploading
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 hover:from-blue-100 hover:to-indigo-100 border-blue-200 hover:shadow-md'
                }`}
                title="Upload all images to cloud"
              >
                {isUploading ? (
                  <>
                    <svg className="w-3.5 h-3.5 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Upload All to Cloud
                  </>
                )}
              </button>
            )}
            {annotatedImages > 0 && dataArtifactId && (
              <a
                href={`${serverUrl}/${dataArtifactId.split('/')[0]}/artifacts/${dataArtifactId.split('/').slice(1).join('/')}/create-zip-file`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 hover:from-green-100 hover:to-emerald-100 rounded-lg transition-all flex items-center border border-green-200 shadow-sm hover:shadow-md"
                title="Download annotations as ZIP"
              >
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download ZIP
              </a>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center border border-red-200"
                title="Delete cloud artifact"
              >
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            )}
          </div>
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
                      <div className="flex items-center flex-1 min-w-0">
                        {cloudImages.has(image) && (
                          <div 
                            className="group relative mr-2 cursor-pointer flex-shrink-0"
                            onClick={(e) => handleDeleteCloudImage(image, e)}
                            title="Delete file from artifact manager"
                          >
                            <svg className="w-4 h-4 text-blue-500 group-hover:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                            </svg>
                            <svg className="w-4 h-4 text-red-500 hidden group-hover:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </div>
                        )}
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
        {showDashboard || !selectedImage ? renderDashboard() : renderImagePreview()}
      </div>
    </div>
  );
};

export default ImageViewer;
