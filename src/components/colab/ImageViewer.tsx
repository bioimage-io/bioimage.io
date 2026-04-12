import React, { useState, useEffect, useCallback } from 'react';

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
          setDataUrl(src);
          return;
        }

        const data = imgData.data;

        const palette = [
          [37, 99, 235],
          [147, 51, 234],
          [219, 39, 119],
          [22, 163, 74],
          [234, 88, 12],
          [220, 38, 38],
          [202, 138, 4],
          [6, 182, 212],
          [139, 92, 246],
          [244, 63, 94],
        ];

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const labelId = (r << 8) | g;

          if (labelId === 0) {
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
          } else {
            const color = palette[(labelId - 1) % palette.length];
            data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        setDataUrl(canvas.toDataURL('image/png'));
      };
      img.onerror = onError;
      img.src = src;
    };

    loadAndColorize();

    return () => { active = false; };
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

export interface SplitInfo {
  applied: boolean;
  testImages: string[];
  trainImages: string[];
}

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
  cellposeModel?: string;
  onDelete?: () => void;
  onUploadAll?: () => Promise<void>;
  onRefresh?: () => void;
  splitInfo?: SplitInfo | null;
  onApplySplit?: (train: string[], test: string[]) => Promise<void>;
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
  cellposeModel,
  onDelete,
  onUploadAll,
  onRefresh,
  splitInfo,
  onApplySplit,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'raw' | 'annotated'>('raw');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [annotationUrl, setAnnotationUrl] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [cloudImages, setCloudImages] = useState<Set<string>>(new Set());
  const [deletedAnnotations, setDeletedAnnotations] = useState<Set<string>>(new Set());

  // Split state
  const [splitMode, setSplitMode] = useState(false);
  const [testImageSet, setTestImageSet] = useState<Set<string>>(new Set());
  const [showRandomSplitDialog, setShowRandomSplitDialog] = useState(false);
  const [randomSplitRatio, setRandomSplitRatio] = useState(10);
  const [showApplyConfirmDialog, setShowApplyConfirmDialog] = useState(false);
  const [isApplyingSplit, setIsApplyingSplit] = useState(false);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<'train' | 'test' | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Sync local testImageSet whenever the committed split changes
  useEffect(() => {
    setTestImageSet(new Set(splitInfo?.testImages ?? []));
  }, [splitInfo]);

  // Derived split lists (based on local pending state)
  const testImages = imageList.filter(img => testImageSet.has(img));
  const trainImages = imageList.filter(img => !testImageSet.has(img));

  const randomSplitTestCount = Math.round(imageList.length * randomSplitRatio / 100);
  const randomSplitTrainCount = imageList.length - randomSplitTestCount;

  const toggleImageSection = useCallback((img: string) => {
    setTestImageSet(prev => {
      const next = new Set(prev);
      if (next.has(img)) next.delete(img);
      else next.add(img);
      return next;
    });
  }, []);

  const applyRandomSplit = () => {
    const shuffled = [...imageList].sort(() => Math.random() - 0.5);
    const testCount = Math.round(shuffled.length * randomSplitRatio / 100);
    setTestImageSet(new Set(shuffled.slice(0, testCount)));
    setShowRandomSplitDialog(false);
  };

  const handleApplySplit = async () => {
    setIsApplyingSplit(true);
    setApplyError(null);
    try {
      const train = imageList.filter(img => !testImageSet.has(img));
      const test = imageList.filter(img => testImageSet.has(img));
      await onApplySplit?.(train, test);
      setShowApplyConfirmDialog(false);
      setSplitMode(false);
    } catch (e: any) {
      console.error('[ImageViewer] Apply split failed:', e);
      setApplyError(e?.message || 'Failed to apply split');
      setSplitMode(false);
      if (onRefresh) onRefresh();
    } finally {
      setIsApplyingSplit(false);
    }
  };

  // Determine which cloud folder an image is in (using committed splitInfo)
  const getImageFolder = useCallback((image: string): string => {
    if (splitInfo?.testImages.includes(image)) return 'test_images';
    return 'train_images';
  }, [splitInfo]);

  // Periodically fetch cloud images from train_images and test_images
  useEffect(() => {
    if (!dataArtifactId || !artifactManager) return;

    let isSubscribed = true;
    const fetchCloudImages = async () => {
      try {
        const [trainFiles, testFiles] = await Promise.all([
          artifactManager.list_files({ artifact_id: dataArtifactId, dir_path: 'train_images', _rkwargs: true }).catch(() => []),
          artifactManager.list_files({ artifact_id: dataArtifactId, dir_path: 'test_images', _rkwargs: true }).catch(() => []),
        ]);
        if (isSubscribed) {
          const all = new Set<string>([
            ...trainFiles.map((f: any) => f.name),
            ...testFiles.map((f: any) => f.name),
          ]);
          setCloudImages(all);
        }
      } catch {
        // ignore
      }
    };

    fetchCloudImages();
    const intervalId = setInterval(fetchCloudImages, 5000);
    return () => { isSubscribed = false; clearInterval(intervalId); };
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
      const folder = getImageFolder(image);
      await artifactManager.remove_file({
        artifact_id: dataArtifactId,
        file_path: `${folder}/${image}`,
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
        setDeletedAnnotations(prev => { const next = new Set(prev); next.add(baseName); return next; });
      }

      setCloudImages(prev => { const next = new Set(prev); next.delete(image); return next; });

      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Failed to delete cloud file(s)', error);
      alert('Failed to delete file(s) from artifact manager');
    }
  };

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
        const imageInArtifact = cloudImages.has(selectedImage);
        const imageFolder = getImageFolder(selectedImage);

        if (imageInArtifact) {
          const rawUrl = `${serverUrl}/bioimage-io/artifacts/${artifactAlias}/files/${imageFolder}/${baseName}.png`;
          setImageUrl(rawUrl);
        } else {
          let localImageLoaded = false;

          if (imageFolderHandle) {
            try {
              const fileHandle = await (imageFolderHandle as any).getFileHandle(selectedImage);
              const file = await fileHandle.getFile();
              setImageUrl(URL.createObjectURL(file));
              localImageLoaded = true;
            } catch (err) {
              console.warn('Failed to read image directly from local folder:', err);
            }
          }

          if (!localImageLoaded && annotationURL && server) {
            try {
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
                  } catch { }
                }
              }

              if (serviceId) {
                const imageService = await server.getService(serviceId);
                const base64Data = await imageService.get_local_image_base64({ image_name: selectedImage, _rkwargs: true });
                setImageUrl(`data:image/png;base64,${base64Data}`);
              } else {
                setImageUrl('');
              }
            } catch (error) {
              console.error('Error reading local image via Hypha service:', error);
              setImageUrl('');
            }
          }
        }

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
  }, [selectedImage, dataArtifactId, label, serverUrl, annotationsList, dataSourceType, imageFolderHandle, executeCode, annotationURL, server, cloudImages, getImageFolder]);

  const totalImages = imageList.length;
  const annotatedImages = imageList.filter(img => isAnnotated(img)).length;
  const progress = totalImages > 0 ? Math.round((annotatedImages / totalImages) * 100) : 0;

  // ─── Drag & drop handlers ─────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, image: string) => {
    e.dataTransfer.setData('text/plain', image);
    setDragItem(image);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDragOverSection(null);
  };

  const handleDragOver = (e: React.DragEvent, section: 'train' | 'test') => {
    e.preventDefault();
    setDragOverSection(section);
  };

  const handleDrop = (e: React.DragEvent, targetSection: 'train' | 'test') => {
    e.preventDefault();
    const image = e.dataTransfer.getData('text/plain');
    if (!image) { setDragOverSection(null); return; }
    const currentlyTest = testImageSet.has(image);
    if (targetSection === 'test' && !currentlyTest) {
      setTestImageSet(prev => { const n = new Set(prev); n.add(image); return n; });
    } else if (targetSection === 'train' && currentlyTest) {
      setTestImageSet(prev => { const n = new Set(prev); n.delete(image); return n; });
    }
    setDragItem(null);
    setDragOverSection(null);
  };

  // ─── Image list item renderer ─────────────────────────────────────────────

  const renderImageItem = (image: string, section: 'train' | 'test' | null) => {
    const annotated = isAnnotated(image);
    const isSelected = selectedImage === image;
    const canInteract = splitMode && !isApplyingSplit;
    const isBeingDragged = dragItem === image;

    return (
      <button
        key={image}
        draggable={canInteract}
        onDragStart={canInteract ? (e) => handleDragStart(e, image) : undefined}
        onDragEnd={canInteract ? handleDragEnd : undefined}
        onDoubleClick={canInteract ? () => toggleImageSection(image) : undefined}
        onClick={() => setSelectedImage(prev => prev === image ? null : image)}
        style={{ borderLeftWidth: '4px', borderLeftColor: isSelected ? 'rgb(168 85 247)' : 'transparent', opacity: isBeingDragged ? 0.4 : 1 }}
        className={`w-full px-4 py-3 text-left transition-colors ${isSelected ? 'bg-purple-50' : 'hover:bg-gray-100'} ${canInteract ? 'cursor-pointer' : ''}`}
        title={canInteract ? 'Double-click to move between sections, or drag' : undefined}
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
            {canInteract && (
              <svg className="w-3 h-3 text-gray-400 mr-1.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
              </svg>
            )}
            <p className={`text-sm font-medium truncate ${isSelected ? 'text-purple-900' : 'text-gray-900'}`}>
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
  };

  // ─── Image list renderer ──────────────────────────────────────────────────

  const renderImageList = () => {
    if (isLoadingImages) {
      return (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      );
    }
    if (imageList.length === 0) {
      return (
        <div className="text-center py-8 px-4">
          <svg className="w-12 h-12 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-sm text-gray-600">No images found</p>
          <p className="text-xs text-gray-500 mt-1">Start a session to upload images</p>
        </div>
      );
    }

    const showSplit = splitMode || (splitInfo?.applied ?? false);

    if (!showSplit) {
      return (
        <div className="divide-y divide-gray-200">
          {imageList.map(img => renderImageItem(img, null))}
        </div>
      );
    }

    const canInteract = splitMode && !isApplyingSplit;

    return (
      <div>
        {/* Test section */}
        <div
          onDragOver={canInteract ? (e) => handleDragOver(e, 'test') : undefined}
          onDragLeave={canInteract ? () => setDragOverSection(null) : undefined}
          onDrop={canInteract ? (e) => handleDrop(e, 'test') : undefined}
          className={`transition-colors ${canInteract && dragOverSection === 'test' ? 'bg-orange-50' : ''}`}
        >
          <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-orange-50 border-b border-orange-200">
            <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Test Images</span>
            <span className="text-xs text-orange-500 ml-auto">{testImages.length}</span>
          </div>
          {testImages.length === 0 ? (
            <div className="px-4 py-3 text-xs text-gray-400 italic">
              {canInteract ? 'Double-click or drag images here' : 'No test images'}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {testImages.map(img => renderImageItem(img, 'test'))}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="flex items-center px-3 py-1 bg-gray-100 border-t border-b border-gray-300">
          <div className="flex-1 h-px bg-gray-300" />
          <span className="mx-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Split</span>
          <div className="flex-1 h-px bg-gray-300" />
        </div>

        {/* Train section */}
        <div
          onDragOver={canInteract ? (e) => handleDragOver(e, 'train') : undefined}
          onDragLeave={canInteract ? () => setDragOverSection(null) : undefined}
          onDrop={canInteract ? (e) => handleDrop(e, 'train') : undefined}
          className={`transition-colors ${canInteract && dragOverSection === 'train' ? 'bg-blue-50' : ''}`}
        >
          <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-200">
            <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Train Images</span>
            <span className="text-xs text-blue-500 ml-auto">{trainImages.length}</span>
          </div>
          {trainImages.length === 0 ? (
            <div className="px-4 py-3 text-xs text-gray-400 italic">
              {canInteract ? 'Double-click or drag images here' : 'No train images'}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {trainImages.map(img => renderImageItem(img, 'train'))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Dashboard ────────────────────────────────────────────────────────────

  const renderDashboard = () => (
    <div className="flex items-center justify-center h-full bg-gradient-to-br from-purple-50/30 via-pink-50/20 to-blue-50/30 overflow-auto">
      <div className="max-w-2xl p-8 w-full">
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
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
          </div>
          {totalImages > 0 && (
            <p className="text-xs text-gray-500 mt-2 text-center">{annotatedImages} of {totalImages} images annotated</p>
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

  // ─── Image preview content (without tab bar) ──────────────────────────────

  const renderImageContent = () => {
    if (!selectedImage) return null;
    const hasAnnotation = isAnnotated(selectedImage);

    return (
      <>
        <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 overflow-auto">
          {viewMode === 'annotated' && !hasAnnotation ? (
            <div className="text-center text-gray-400">
              <svg className="w-16 h-16 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">No annotation for this image yet.</p>
            </div>
          ) : viewMode === 'raw' && imageUrl ? (
            <img
              src={imageUrl}
              alt={selectedImage}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5JbWFnZSBub3QgYXZhaWxhYmxlPC90ZXh0Pjwvc3ZnPg==';
              }}
            />
          ) : viewMode === 'annotated' && annotationUrl ? (
            <ColorizedMask
              src={annotationUrl}
              alt={`${selectedImage} (annotated)`}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              onError={(e) => {
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

        <div className="bg-white border-t border-gray-200 px-6 py-3 flex-shrink-0">
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
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Completed</span>
            )}
          </div>
        </div>
      </>
    );
  };

  const displayName = sessionName || 'Annotation Session';
  const hasUnuploadedImages = imageList.some(img => !cloudImages.has(img));

  return (
    <div className="flex h-full bg-white/80 backdrop-blur-sm rounded-2xl shadow-md border border-gray-200/60 overflow-hidden">

      {/* ── Sidebar ── */}
      <div className="w-80 border-r border-gray-200/60 flex flex-col bg-gradient-to-b from-gray-50 to-purple-50/20">
        <div className="border-b border-gray-200 bg-white">
          <div className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-800 truncate flex-1">{displayName}</h3>
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
              <span className="text-gray-500">{imageList.length} total · {annotatedImages} annotated</span>
            </div>
            {dataArtifactId && (
              <div className="text-[9px] text-gray-400 mt-1 font-mono truncate">{dataArtifactId}</div>
            )}
          </div>

          {/* Action buttons */}
          <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isLoadingImages}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center border shadow-sm ${isLoadingImages ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 hover:from-purple-100 hover:to-pink-100 border-purple-200 hover:shadow-md'}`}
                title="Refresh image list"
              >
                <svg className={`w-3.5 h-3.5 mr-1.5 ${isLoadingImages ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isLoadingImages ? 'Refreshing...' : 'Refresh'}
              </button>
            )}

            {/* Random split button — only in split mode */}
            {splitMode && imageList.length > 0 && onApplySplit && (
              <button
                onClick={() => setShowRandomSplitDialog(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center border shadow-sm bg-gradient-to-r from-orange-50 to-yellow-50 text-orange-700 hover:from-orange-100 hover:to-yellow-100 border-orange-200 hover:shadow-md"
                title="Random train/test split"
              >
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Random Split
              </button>
            )}

            {hasUnuploadedImages && onUploadAll && (
              <button
                onClick={async () => { setIsUploading(true); try { await onUploadAll(); } finally { setIsUploading(false); } }}
                disabled={isUploading}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center border shadow-sm ${isUploading ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 hover:from-blue-100 hover:to-indigo-100 border-blue-200 hover:shadow-md'}`}
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

        {/* Image list */}
        <div className="flex-1 overflow-y-auto">
          {renderImageList()}
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Persistent top bar: tabs + info fields + split button */}
        <div className="flex items-center border-b border-gray-200 bg-white px-4 min-h-[48px] flex-shrink-0">
          {selectedImage ? (
            <>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-4 py-3 font-medium text-sm transition-colors ${viewMode === 'raw' ? 'border-b-2 border-purple-500 text-purple-600' : 'text-gray-600 hover:text-gray-800'}`}
              >
                Raw Image
              </button>
              <button
                onClick={() => setViewMode('annotated')}
                className={`px-4 py-3 font-medium text-sm transition-colors ${viewMode === 'annotated' ? 'border-b-2 border-purple-500 text-purple-600' : 'text-gray-600 hover:text-gray-800'}`}
              >
                Annotated
              </button>
              {label && (
                <span className="ml-2 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-700">
                  {label}
                </span>
              )}
            </>
          ) : null}

          <div className="flex-1" />

          {/* Cellpose model info */}
          {cellposeModel && (
            <span className="mr-3 px-2 py-1 rounded text-[11px] text-gray-500 bg-gray-100 border border-gray-200 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {cellposeModel === 'cpsam' ? 'Base (Cellpose-SAM)' : cellposeModel}
            </span>
          )}

          {/* Split toggle / apply button */}
          {imageList.length > 0 && onApplySplit && (
            splitMode ? (
              <button
                onClick={() => setShowApplyConfirmDialog(true)}
                disabled={isApplyingSplit}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Apply Data Split
              </button>
            ) : (
              <button
                onClick={() => setSplitMode(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Data Split
              </button>
            )
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedImage ? renderDashboard() : renderImageContent()}
        </div>
      </div>

      {/* ── Random Split Dialog ── */}
      {showRandomSplitDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowRandomSplitDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Random Train/Test Split</h3>
            <p className="text-xs text-gray-500 mb-4">Randomly assign images to train and test sets based on the ratio below.</p>

            {testImageSet.size > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200 flex items-start gap-2">
                <svg className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs text-yellow-700">
                  <strong>{testImageSet.size} image(s)</strong> are already assigned to the test set. This random split will overwrite your existing assignment.
                </p>
              </div>
            )}

            <div className="mb-2">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Test ratio: <strong>{randomSplitRatio}%</strong></span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                value={randomSplitRatio}
                onChange={e => setRandomSplitRatio(Number(e.target.value))}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>0%</span>
                <span>50%</span>
              </div>
            </div>

            <div className="flex gap-3 mb-4">
              <div className="flex-1 rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                <div className="text-xl font-bold text-blue-700">{randomSplitTrainCount}</div>
                <div className="text-xs text-blue-600">Train images</div>
              </div>
              <div className="flex-1 rounded-lg bg-orange-50 border border-orange-200 p-3 text-center">
                <div className="text-xl font-bold text-orange-700">{randomSplitTestCount}</div>
                <div className="text-xs text-orange-600">Test images</div>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRandomSplitDialog(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={applyRandomSplit}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Apply Split Confirmation Dialog ── */}
      {showApplyConfirmDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => !isApplyingSplit && setShowApplyConfirmDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Apply Data Split</h3>
            <p className="text-xs text-gray-500 mb-4">
              Confirm the following train/test split: <strong>{trainImages.length} train</strong> and <strong>{testImages.length} test</strong> images.
            </p>

            <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700 space-y-2">
              <p><strong>What will happen:</strong></p>
              <ul className="list-disc list-inside space-y-1 text-gray-600">
                <li>Images will be moved between <code>train_images/</code> and <code>test_images/</code> as needed. This requires downloading and re-uploading each moved file.</li>
                <li>Images not yet uploaded will be tagged internally and put into the correct folder when uploaded.</li>
              </ul>
            </div>

            {applyError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                <strong>Error:</strong> {applyError}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowApplyConfirmDialog(false); setApplyError(null); }}
                disabled={isApplyingSplit}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApplySplit}
                disabled={isApplyingSplit}
                className="px-4 py-2 text-sm font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isApplyingSplit ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Applying...
                  </>
                ) : 'Apply Split'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageViewer;
