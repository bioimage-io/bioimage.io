import React, { useState, useEffect } from 'react';

// Shared with DatasetCard (colab-rework-plan.md F2) for label badge colors,
// and with the mask recoloring below, so a label's badge and its instance
// colors in the annotated view draw from the same set.
export const LABEL_PALETTE: Array<[number, number, number]> = [
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

// Recolors a label-id-encoded mask PNG (label id packed into the red/green
// channels as `(r << 8) | g`) using a fixed palette, entirely client-side via
// a canvas. Shared by ImageViewer (session dashboard) and the dataset
// overview (colab-rework-plan.md F4) so both get the same annotation look.
export const ColorizedMask = ({
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

const IMAGE_FALLBACK_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5JbWFnZSBub3QgYXZhaWxhYmxlPC90ZXh0Pjwvc3ZnPg==';

const ANNOTATION_FALLBACK_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5Bbm5vdGF0aW9uIG5vdCBhdmFpbGFibGU8L3RleHQ+PC9zdmc+';

export interface ImagePreviewProps {
  viewMode: 'raw' | 'annotated';
  imageUrl: string;
  annotationUrl: string;
  hasAnnotation: boolean;
  alt: string;
  // When set, the displayed image supports a press-and-hold A/B comparison:
  // holding down shows the raw image, releasing (or the pointer leaving or
  // being cancelled) shows the annotation again (colab-rework-plan.md §19b
  // item 4). Using hold instead of click-toggle means the view can never be
  // left stuck on raw while the rest of the UI still believes annotations
  // are shown. Omit to render a plain, non-interactive image (e.g. outside
  // browse mode).
  onHoldChange?: (holding: boolean) => void;
}

// The center preview pane shared by ImageViewer (session dashboard) and, once
// built, the dataset overview (colab-rework-plan.md F4): raw image or
// colorized mask depending on `viewMode`, with a loading state while the
// presigned URL for the current selection resolves.
export const ImagePreview: React.FC<ImagePreviewProps> = ({
  viewMode,
  imageUrl,
  annotationUrl,
  hasAnnotation,
  alt,
  onHoldChange,
}) => {
  if (viewMode === 'annotated' && !hasAnnotation) {
    return (
      <div className="text-center text-gray-400">
        <svg className="w-16 h-16 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm">No annotation for this image yet.</p>
      </div>
    );
  }

  const holdableClass = onHoldChange
    ? 'cursor-pointer active:scale-[0.99] transition-transform duration-150 select-none'
    : '';
  const hint = viewMode === 'raw' ? 'Release to see annotation' : 'Hold to see original image';

  // Pointer capture guarantees pointerup/pointercancel fire on this same
  // element regardless of where the pointer ends up, so a hold can never be
  // left "stuck" showing raw even if the pointer drifts off the image or a
  // touch gesture is interrupted (colab-rework-plan.md §19b item 4).
  const holdHandlers = onHoldChange
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onHoldChange(true);
        },
        onPointerUp: () => onHoldChange(false),
        onPointerLeave: () => onHoldChange(false),
        onPointerCancel: () => onHoldChange(false),
        style: { touchAction: 'none' as const },
      }
    : {};

  if (viewMode === 'raw' && imageUrl) {
    return (
      <div className="group relative max-w-full max-h-full" {...holdHandlers}>
        <img
          src={imageUrl}
          alt={alt}
          className={`max-w-full max-h-full object-contain rounded-lg shadow-lg ${holdableClass}`}
          onError={(e) => {
            (e.target as HTMLImageElement).src = IMAGE_FALLBACK_SVG;
          }}
        />
        {onHoldChange && (
          <span className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/60 text-white text-xs opacity-100 transition-opacity duration-150 pointer-events-none">
            {hint}
          </span>
        )}
      </div>
    );
  }

  if (viewMode === 'annotated' && annotationUrl) {
    return (
      <div className="group relative max-w-full max-h-full" {...holdHandlers}>
        <ColorizedMask
          src={annotationUrl}
          alt={`${alt} (annotated)`}
          className={`max-w-full max-h-full object-contain rounded-lg shadow-lg ${holdableClass}`}
          onError={(e) => {
            const target = e.target || e;
            if (target && typeof target === 'object' && 'src' in target) {
              (target as HTMLImageElement).src = ANNOTATION_FALLBACK_SVG;
            }
          }}
        />
        {onHoldChange && (
          <span className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
            {hint}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="text-center text-gray-400">
      <svg className="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <p>Loading image...</p>
    </div>
  );
};
