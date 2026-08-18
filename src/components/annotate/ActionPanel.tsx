import React from 'react';
import {
  IconButton,
  Tooltip,
  Box,
  Typography,
  Divider,
  ButtonBase,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ContrastIcon from '@mui/icons-material/Contrast';
import FilterListIcon from '@mui/icons-material/FilterList';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import InfoIcon from '@mui/icons-material/Info';
import { useAnnotationStore } from '../../store/annotationStore';
import { useResponsiveLayout } from './hooks/useResponsiveLayout';
import { usePanelExpansion } from './hooks/usePanelExpansion';
import { floatingPanelSx, floatingBtnSx, reducedMotionSx, iconSlotSx } from './floatingPanelStyles';
import { isSmallImageDims, SMALL_IMAGE_WARNING_TEXT } from '../../utils/imageSize';

export interface ActionPanelProps {
  onSave: () => void;
  onUndo: () => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onClearAll: () => void;
  onToggleCLAHE: () => void;
  onOpenMaskFilter: () => void;
  onUploadGeoJSON: (file: File) => void;
  imageName?: string;
  isSaving: boolean;
  isCLAHEActive: boolean;
  isLowContrast?: boolean;
  /** True while the page has no viewable session (access denied or login
   * required, colab-rework-plan.md §19 item 10): dims the whole panel and
   * blocks interaction so it reads as non-interactive rather than just
   * being covered up. */
  disabled?: boolean;
}

const ActionPanel: React.FC<ActionPanelProps> = ({
  onSave, onUndo, onResetView, onZoomIn, onZoomOut, onClearAll, onToggleCLAHE, onOpenMaskFilter, onUploadGeoJSON,
  imageName, isSaving, isCLAHEActive, isLowContrast = false, disabled = false,
}) => {
  const canUndo = useAnnotationStore((s) => s.canUndo);
  const imageWidth = useAnnotationStore((s) => s.imageWidth);
  const imageHeight = useAnnotationStore((s) => s.imageHeight);
  const isSmallImage = isSmallImageDims(imageWidth, imageHeight);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { isPortrait, isCompact } = useResponsiveLayout();

  const isExpanded = usePanelExpansion((s) => s.actionsExpanded);
  const setActionsExpanded = usePanelExpansion((s) => s.setActionsExpanded);

  const wasAutoCollapsed = React.useRef(false);
  React.useEffect(() => {
    if (isCompact && isExpanded && !wasAutoCollapsed.current) {
      wasAutoCollapsed.current = true;
      setActionsExpanded(false, isPortrait);
    }
  }, [isCompact]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = () => {
    wasAutoCollapsed.current = false;
    setActionsExpanded(!isExpanded, isPortrait);
  };

  const btnSize = isCompact ? 'medium' : 'small';
  const touchSx = isCompact ? { minWidth: 44, minHeight: 44 } : {};

  const fileInput = (
    <input
      type="file"
      ref={fileInputRef}
      style={{ display: 'none' }}
      accept=".geojson,.json,application/geo+json,application/json"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) { onUploadGeoJSON(f); e.target.value = ''; }
      }}
    />
  );

  // Floating placement: right edge in landscape, bottom edge in portrait —
  // mirrors ToolBar's opposite-edge placement.
  const anchorSx = isPortrait
    ? { bottom: 12, left: 12, right: 12 }
    : { top: 'calc(var(--annotate-header-h) + 12px)', right: 12, bottom: 12 };

  const tooltipPlacement = isPortrait ? 'top' : 'left';

  const claheTitle = isCLAHEActive
    ? 'Restore Original Image'
    : isLowContrast
    ? 'Low contrast detected. Enhance Contrast (CLAHE)'
    : 'Enhance Contrast (CLAHE)';

  return (
    <Box
      role="toolbar"
      aria-label="Annotation actions"
      aria-disabled={disabled}
      sx={{
        position: 'absolute',
        zIndex: 1000,
        ...anchorSx,
        display: 'flex',
        flexDirection: isPortrait ? 'row' : 'column',
        alignItems: isPortrait ? 'center' : 'flex-end',
        justifyContent: isPortrait ? 'flex-end' : undefined,
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        transition: 'opacity 150ms ease-out',
      }}
    >
      {/* ── Collapsed strip ─────────────────────────────────────────────── */}
      {!isExpanded && (
        <Box sx={{
          display: 'flex', flexDirection: isPortrait ? 'row' : 'column', alignItems: 'center',
          p: isCompact ? 0.75 : 0.5, gap: isCompact ? 0.75 : 0.5,
          height: 'fit-content',
          ...(isPortrait ? { maxWidth: '100%', overflowX: 'auto' } : { maxHeight: '100%', overflowY: 'auto' }),
          ...floatingPanelSx,
        }}>
          <Tooltip title="Expand actions" placement={tooltipPlacement}>
            <IconButton
              size={btnSize}
              onClick={toggleExpanded}
              aria-label="Expand actions"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}
            >
              {isPortrait ? <ExpandLessIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          <Divider flexItem orientation={isPortrait ? 'vertical' : 'horizontal'} sx={{ opacity: 0.35 }} />

          {/* View */}
          <Tooltip title="Fit to Image" placement={tooltipPlacement}>
            <IconButton size={btnSize} data-tool="fit" onClick={onResetView} aria-label="Fit to Image"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}>
              <CenterFocusStrongIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Zoom In" placement={tooltipPlacement}>
            <IconButton size={btnSize} data-tool="zoom-in" onClick={onZoomIn} aria-label="Zoom In"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}>
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Zoom Out" placement={tooltipPlacement}>
            <IconButton size={btnSize} data-tool="zoom-out" onClick={onZoomOut} aria-label="Zoom Out"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}>
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={claheTitle} placement={tooltipPlacement}>
            <IconButton size={btnSize} data-tool="clahe" onClick={onToggleCLAHE} aria-label="Enhance Contrast"
              sx={isCLAHEActive ? { ...floatingBtnSx(true), flexShrink: 0, ...touchSx } : isLowContrast ? {
                ...floatingBtnSx(), flexShrink: 0,
                color: 'warning.main',
                animation: 'clahe-pulse 2s ease-in-out infinite',
                '@keyframes clahe-pulse': {
                  '0%, 100%': { boxShadow: '0 0 0 0 rgba(237,108,2,0)' },
                  '50%': { boxShadow: '0 0 0 3px rgba(237,108,2,0.35)' },
                },
                ...touchSx,
              } : { ...floatingBtnSx(), flexShrink: 0, ...touchSx }}>
              <ContrastIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Divider flexItem orientation={isPortrait ? 'vertical' : 'horizontal'} sx={{ opacity: 0.35 }} />

          {/* Edit */}
          <Tooltip title="Undo (Ctrl+Z)" placement={tooltipPlacement}>
            <span>
              <IconButton size={btnSize} data-tool="undo" onClick={onUndo} disabled={!canUndo} aria-label="Undo"
                sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Clear All Annotations" placement={tooltipPlacement}>
            <IconButton size={btnSize} data-tool="clear" onClick={onClearAll} aria-label="Clear All Annotations"
              sx={{ ...floatingBtnSx(), flexShrink: 0, color: 'error.main', ...touchSx }}>
              <DeleteSweepIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Filter Masks by Area" placement={tooltipPlacement}>
            <IconButton size={btnSize} data-tool="filter" onClick={onOpenMaskFilter} aria-label="Filter Masks by Area"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}>
              <FilterListIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Divider flexItem orientation={isPortrait ? 'vertical' : 'horizontal'} sx={{ opacity: 0.35 }} />

          {/* Data */}
          <Tooltip title={isSaving ? 'Saving…' : 'Save Annotation'} placement={tooltipPlacement}>
            <span>
              <IconButton
                size={btnSize}
                data-tool="save"
                onClick={onSave}
                disabled={isSaving}
                aria-label="Save Annotation"
                sx={{
                  ...floatingBtnSx(), flexShrink: 0,
                  bgcolor: 'success.main', color: 'white',
                  '&:hover': { bgcolor: 'success.dark' },
                  '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.12)', color: 'rgba(0,0,0,0.3)' },
                  ...touchSx,
                }}
              >
                <SaveIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Import Annotation" placement={tooltipPlacement}>
            <IconButton size={btnSize} data-tool="upload" onClick={() => fileInputRef.current?.click()} aria-label="Import Annotation"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}>
              <UploadFileIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {fileInput}

          <Divider flexItem orientation={isPortrait ? 'vertical' : 'horizontal'} sx={{ opacity: 0.35 }} />

          {/* Help */}
          <Tooltip
            title={
              isSmallImage
                ? `${imageName || 'No image'} (${imageWidth}×${imageHeight} px). ${SMALL_IMAGE_WARNING_TEXT}`
                : `${imageName || 'No image'} (${imageWidth}×${imageHeight} px)`
            }
            placement={tooltipPlacement}
          >
            <IconButton size={btnSize} data-tool="info" aria-label="Image info"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...(isSmallImage ? { color: 'warning.main' } : {}), ...touchSx }}>
              <InfoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* ── Expanded panel ──────────────────────────────────────────────── */}
      {isExpanded && (
        <Box sx={{
          display: 'flex', flexDirection: 'column',
          p: 1, gap: 0.25,
          width: isPortrait ? '100%' : 224,
          height: 'fit-content',
          maxHeight: isPortrait ? '55vh' : '100%',
          overflowY: 'auto', overflowX: 'hidden',
          ...floatingPanelSx,
        }}>
          <Box
            component="button"
            type="button"
            onClick={toggleExpanded}
            aria-label="Collapse actions"
            sx={{
              display: 'flex', alignItems: 'center', px: 1, py: isCompact ? 1 : 0.6, mb: 0.25,
              borderRadius: 1.5, cursor: 'pointer', border: 'none', font: 'inherit',
              bgcolor: 'rgba(0,0,0,0.04)',
              touchAction: 'manipulation',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.08)' },
              transition: 'background-color 140ms ease',
              minHeight: isCompact ? 44 : undefined,
            }}
          >
            {isPortrait ? <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.disabled', mr: 0.5 }} /> : <ChevronRightIcon sx={{ fontSize: 16, color: 'text.disabled', mr: 0.5 }} />}
            <Typography variant="caption" sx={{
              fontWeight: 700, color: 'text.disabled',
              textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.58rem', flex: 1,
              textAlign: 'left',
            }}>
              Actions
            </Typography>
          </Box>

          <ButtonBase onClick={onResetView} data-tool="fit" aria-label="Fit to Image"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.05)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: 'text.secondary', mt: 0.2 }}>
              <CenterFocusStrongIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={600} display="block" data-testid="row-title">Fit to Image</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                Reset the view to show the full image
              </Typography>
            </Box>
          </ButtonBase>

          <ButtonBase onClick={onZoomIn} data-tool="zoom-in" aria-label="Zoom In"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.05)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: 'text.secondary', mt: 0.2 }}>
              <ZoomInIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={600} display="block" data-testid="row-title">Zoom In</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                Increase magnification
              </Typography>
            </Box>
          </ButtonBase>

          <ButtonBase onClick={onZoomOut} data-tool="zoom-out" aria-label="Zoom Out"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.05)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: 'text.secondary', mt: 0.2 }}>
              <ZoomOutIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={600} display="block" data-testid="row-title">Zoom Out</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                Decrease magnification
              </Typography>
            </Box>
          </ButtonBase>

          <ButtonBase onClick={onToggleCLAHE} data-tool="clahe" aria-label="Enhance Contrast"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              bgcolor: isCLAHEActive ? 'rgba(25,118,210,0.10)' : 'transparent',
              '&:hover': { bgcolor: isCLAHEActive ? 'rgba(25,118,210,0.14)' : isLowContrast ? 'rgba(237,108,2,0.08)' : 'rgba(0,0,0,0.05)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: isCLAHEActive ? 'primary.main' : isLowContrast ? 'warning.main' : 'text.secondary', mt: 0.2 }}>
              <ContrastIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={600} color={isCLAHEActive ? 'primary.main' : isLowContrast ? 'warning.main' : 'text.primary'} display="block"
                data-testid="row-title">
                {isCLAHEActive ? 'Restore Original' : 'Enhance Contrast'}
              </Typography>
              <Typography variant="caption" color={isLowContrast && !isCLAHEActive ? 'warning.main' : 'text.secondary'} display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                {isLowContrast && !isCLAHEActive ? 'Low contrast detected' : 'CLAHE contrast enhancement'}
              </Typography>
            </Box>
          </ButtonBase>

          <Divider sx={{ my: 0.5 }} />

          <ButtonBase onClick={onUndo} disabled={!canUndo} data-tool="undo" aria-label="Undo"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.05)' }, '&.Mui-disabled': { opacity: 0.45 },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: 'text.secondary', mt: 0.2 }}>
              <UndoIcon fontSize="small" />
            </Box>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
                <Typography variant="caption" fontWeight={600} data-testid="row-title">Undo</Typography>
                {!isCompact && (
                  <Typography component="span" sx={{
                    fontSize: '0.58rem', color: 'text.disabled', fontFamily: 'monospace',
                    bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5, lineHeight: 1.6,
                  }}>Ctrl+Z</Typography>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                Revert last annotation change
              </Typography>
            </Box>
          </ButtonBase>

          <ButtonBase onClick={onClearAll} data-tool="clear" aria-label="Clear All Annotations"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              '&:hover': { bgcolor: 'rgba(211,47,47,0.06)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: 'error.main', mt: 0.2 }}>
              <DeleteSweepIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={600} color="error.main" display="block" data-testid="row-title">Clear All</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                Remove all annotations on this image
              </Typography>
            </Box>
          </ButtonBase>

          <ButtonBase onClick={onOpenMaskFilter} data-tool="filter" aria-label="Filter Masks by Area"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.05)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: 'text.secondary', mt: 0.2 }}>
              <FilterListIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={600} display="block" data-testid="row-title">Filter Masks</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                Remove masks below a minimum area
              </Typography>
            </Box>
          </ButtonBase>

          <Divider sx={{ my: 0.5 }} />

          <ButtonBase onClick={onSave} disabled={isSaving} data-tool="save" aria-label="Save Annotation"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              bgcolor: 'success.main', color: 'success.contrastText',
              '&:hover': { bgcolor: 'success.dark' }, '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.12)', color: 'rgba(0,0,0,0.3)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
              transition: 'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), background-color 140ms ease',
              '&:active': { transform: 'scale(0.98)' },
              ...reducedMotionSx,
            }}>
            <Box sx={{ ...iconSlotSx, mt: 0.2 }}>
              <SaveIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={700} display="block" data-testid="row-title">
                {isSaving ? 'Saving…' : 'Save Annotation'}
              </Typography>
              <Typography variant="caption" display="block" sx={{ fontSize: '0.63rem', opacity: 0.85, lineHeight: 1.3, mt: 0.1 }}>
                Upload masks to cloud storage
              </Typography>
            </Box>
          </ButtonBase>

          <ButtonBase onClick={() => fileInputRef.current?.click()} data-tool="upload" aria-label="Import Annotation"
            sx={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
              px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.05)' },
              minHeight: isCompact ? 48 : undefined, touchAction: 'manipulation',
            }}>
            <Box sx={{ ...iconSlotSx, color: 'text.secondary', mt: 0.2 }}>
              <UploadFileIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={600} display="block" data-testid="row-title">Import Annotation</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                Uploads a GeoJSON file
              </Typography>
            </Box>
          </ButtonBase>
          {fileInput}

          <Divider sx={{ my: 0.5 }} />

          {(imageName || (imageWidth && imageHeight)) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.4 }}>
              <InfoIcon sx={{ fontSize: '0.85rem', color: isSmallImage ? 'warning.main' : 'text.disabled' }} aria-hidden="true" />
              <Typography variant="caption" color={isSmallImage ? 'warning.main' : 'text.disabled'} sx={{ fontSize: '0.6rem' }} noWrap>
                {imageName}{imageWidth && imageHeight ? ` (${imageWidth}×${imageHeight} px)` : ''}
              </Typography>
            </Box>
          )}
          {isSmallImage && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, pb: 0.4 }}>
              <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.58rem', lineHeight: 1.3 }}>
                {SMALL_IMAGE_WARNING_TEXT}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default ActionPanel;
