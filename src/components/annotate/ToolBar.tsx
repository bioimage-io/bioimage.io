import React from 'react';
import {
  IconButton,
  Tooltip,
  Box,
  Typography,
  Divider,
  ButtonBase,
  Button,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import NearMeIcon from '@mui/icons-material/NearMe';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import BrushIcon from '@mui/icons-material/Brush';
import PolylineIcon from '@mui/icons-material/Polyline';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SaveIcon from '@mui/icons-material/Save';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import ContrastIcon from '@mui/icons-material/Contrast';
import FilterListIcon from '@mui/icons-material/FilterList';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import InfoIcon from '@mui/icons-material/Info';
import { useAnnotationStore, AnnotationTool } from '../../store/annotationStore';

const EXPANDED_KEY = 'bioimage-toolbar-expanded';


interface ToolDef {
  id: AnnotationTool;
  name: string;
  shortcut: string;
  description: string;
  icon: React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { id: 'move',     name: 'Move',        shortcut: 'M', description: 'Pan and navigate the image',                              icon: <OpenWithIcon fontSize="small" /> },
  { id: 'select',   name: 'Select',      shortcut: 'S', description: 'Click a mask to select it; Shift for multi, Del to delete', icon: <NearMeIcon fontSize="small" /> },
  { id: 'polygon',  name: 'Draw Mask',   shortcut: 'D', description: 'Click to place vertices, double-click to close the polygon', icon: <PolylineIcon fontSize="small" /> },
  { id: 'cutter',   name: 'Cut Mask',    shortcut: 'C', description: 'Draw a line across an existing mask to split it',          icon: <ContentCutIcon fontSize="small" /> },
  { id: 'eraser',   name: 'Eraser',      shortcut: 'E', description: 'Paint to remove areas from an existing mask',              icon: <AutoFixOffIcon fontSize="small" /> },
  { id: 'expander', name: 'Expand Mask', shortcut: 'A', description: 'Paint to add area to an existing mask',                    icon: <BrushIcon fontSize="small" /> },
];

// Shared collapsed-mode icon button style
const collapsedBtnSx = (active = false) => ({
  borderRadius: 1.5,
  bgcolor: active ? 'primary.main' : 'rgba(255,255,255,0.72)',
  color: active ? 'white' : 'inherit',
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
  '&:hover': { bgcolor: active ? 'primary.dark' : 'rgba(255,255,255,0.95)' },
  '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.35)', boxShadow: 'none' },
});

export interface ToolBarProps {
  onRunCellpose?: () => void;
  onOpenCellposeConfig: () => void;
  onSave: () => void;
  onUndo: () => void;
  onResetView: () => void;
  onClearAll: () => void;
  onToggleCLAHE: () => void;
  onOpenMaskFilter: () => void;
  onHelp: () => void;
  onUploadGeoJSON: (file: File) => void;
  sessionUrl?: string | null;
  imageName?: string;
  cellposeModel?: string;
  isSaving: boolean;
  isRunningCellpose: boolean;
  isCLAHEActive: boolean;
  hasCustomCellposeConfig: boolean;
}

const ToolBar: React.FC<ToolBarProps> = ({
  onOpenCellposeConfig, onSave, onUndo, onResetView,
  onClearAll, onToggleCLAHE, onOpenMaskFilter, onHelp, onUploadGeoJSON,
  sessionUrl, imageName, cellposeModel,
  isSaving, isRunningCellpose, isCLAHEActive,
}) => {
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const canUndo = useAnnotationStore((s) => s.canUndo);
  const imageWidth = useAnnotationStore((s) => s.imageWidth);
  const imageHeight = useAnnotationStore((s) => s.imageHeight);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [isExpanded, setIsExpanded] = React.useState(() => {
    try { return localStorage.getItem(EXPANDED_KEY) !== 'false'; } catch { return true; }
  });

  const toggleExpanded = () => {
    setIsExpanded(v => {
      const next = !v;
      try { localStorage.setItem(EXPANDED_KEY, String(next)); } catch {}
      return next;
    });
  };

  const modelLabel = (!cellposeModel || cellposeModel === 'cpsam')
    ? 'Base (Cellpose-SAM)'
    : cellposeModel;

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

  // ── Collapsed ──────────────────────────────────────────────────────────────
  if (!isExpanded) {
    return (
      <Box sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        py: 1, px: 0.5, gap: 0.5,
        width: 52, flexShrink: 0,
        background: 'rgba(255,255,255,0.20)',
        backdropFilter: 'blur(6px)',
        borderRight: '1px solid rgba(255,255,255,0.28)',
      }}>
        {/* Expand toggle */}
        <Tooltip title="Expand toolbar" placement="right">
          <IconButton size="small" onClick={toggleExpanded} sx={{ ...collapsedBtnSx(), mb: 0.25 }}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Drawing tools */}
        {TOOLS.map((tool) => (
          <React.Fragment key={tool.id}>
            <Tooltip title={`${tool.name} (${tool.shortcut})`} placement="right">
              <IconButton
                size="small"
                data-tool={tool.id}
                onClick={() => setActiveTool(tool.id)}
                sx={collapsedBtnSx(activeTool === tool.id)}
              >
                {tool.icon}
              </IconButton>
            </Tooltip>

            {/* AI Segmentation sits right after Draw Mask */}
            {tool.id === 'polygon' && (
              <Tooltip title={`AI Segmentation — ${modelLabel}`} placement="right">
                <span>
                  <IconButton
                    size="small"
                    data-tool="cellpose"
                    onClick={onOpenCellposeConfig}
                    disabled={isRunningCellpose}
                    sx={{
                      ...collapsedBtnSx(),
                      bgcolor: 'rgba(156,39,176,0.12)',
                      color: 'secondary.main',
                      '&:hover': { bgcolor: 'rgba(156,39,176,0.22)' },
                    }}
                  >
                    <AutoAwesomeIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {/* Save sits right after Expand Mask */}
            {tool.id === 'expander' && (
              <Tooltip title="Save Annotation" placement="right">
                <span>
                  <IconButton size="small" data-tool="save" onClick={onSave} disabled={isSaving}
                    sx={{ ...collapsedBtnSx(), color: 'success.main' }}>
                    <SaveIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </React.Fragment>
        ))}

        <Divider flexItem sx={{ my: 0.25, opacity: 0.35 }} />

        <Tooltip title="Undo (Ctrl+Z)" placement="right">
          <span>
            <IconButton size="small" data-tool="undo" onClick={onUndo} disabled={!canUndo} sx={collapsedBtnSx()}>
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Clear All Annotations" placement="right">
          <IconButton size="small" data-tool="clear" onClick={onClearAll}
            sx={{ ...collapsedBtnSx(), color: 'error.main' }}>
            <DeleteSweepIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Divider flexItem sx={{ my: 0.25, opacity: 0.35 }} />

        <Tooltip title="Filter Masks by Area" placement="right">
          <IconButton size="small" data-tool="filter" onClick={onOpenMaskFilter} sx={collapsedBtnSx()}>
            <FilterListIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Fit to Image" placement="right">
          <IconButton size="small" data-tool="fit" onClick={onResetView} sx={collapsedBtnSx()}>
            <CenterFocusStrongIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={isCLAHEActive ? 'Restore Original Image' : 'Enhance Contrast (CLAHE)'} placement="right">
          <IconButton size="small" data-tool="clahe" onClick={onToggleCLAHE}
            sx={collapsedBtnSx(isCLAHEActive)}>
            <ContrastIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Divider flexItem sx={{ my: 0.25, opacity: 0.35 }} />

        <Tooltip title={`${imageName || 'No image'} — ${imageWidth}×${imageHeight} px`} placement="right">
          <IconButton size="small" data-tool="info" sx={collapsedBtnSx()}>
            <InfoIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Upload GeoJSON" placement="right">
          <IconButton size="small" data-tool="upload" onClick={() => fileInputRef.current?.click()} sx={collapsedBtnSx()}>
            <UploadFileIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {fileInput}

        {sessionUrl && (
          <Tooltip title="Session overview — view all images, annotation progress & training" placement="right">
            <IconButton size="small" data-tool="session"
              onClick={() => window.open(sessionUrl, '_blank', 'noopener,noreferrer')}
              sx={{ ...collapsedBtnSx(), color: 'info.main' }}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        <Box sx={{ flex: 1 }} />

        <Tooltip title="Help & Tutorial" placement="right">
          <IconButton size="small" data-tool="help" onClick={onHelp} sx={collapsedBtnSx()}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────
  const rowSx = (active = false) => ({
    display: 'flex', alignItems: 'flex-start', gap: 1,
    px: 1, py: 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left' as const,
    bgcolor: active ? 'rgba(25,118,210,0.08)' : 'transparent',
    border: '1px solid',
    borderColor: active ? 'rgba(25,118,210,0.25)' : 'transparent',
    '&:hover': { bgcolor: active ? 'rgba(25,118,210,0.10)' : 'rgba(0,0,0,0.04)' },
    transition: 'background 0.12s',
    '&.Mui-disabled': { opacity: 0.45 },
  });

  const ShortcutBadge = ({ k }: { k: string }) => (
    <Typography component="span" sx={{
      fontSize: '0.58rem', color: 'text.disabled', fontFamily: 'monospace',
      bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5, lineHeight: 1.6,
    }}>{k}</Typography>
  );

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column',
      py: 1, px: 1, gap: 0.25,
      width: 224, flexShrink: 0,
      background: 'rgba(255,255,255,0.97)',
      backdropFilter: 'blur(12px)',
      borderRight: '1px solid rgba(0,0,0,0.09)',
      boxShadow: '2px 0 10px rgba(0,0,0,0.07)',
      overflowY: 'auto', overflowX: 'hidden',
    }}>
      {/* Header with prominent collapse button */}
      <Tooltip title="Collapse toolbar" placement="right">
        <Box
          onClick={toggleExpanded}
          sx={{
            display: 'flex', alignItems: 'center', px: 1, py: 0.6, mb: 0.25,
            borderRadius: 1.5, cursor: 'pointer',
            bgcolor: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(0,0,0,0.07)',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.08)' },
            transition: 'background 0.15s',
          }}
        >
          <Typography variant="caption" sx={{
            fontWeight: 700, color: 'text.disabled',
            textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.58rem', flex: 1,
          }}>
            Annotation Tools
          </Typography>
          <ChevronLeftIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
        </Box>
      </Tooltip>

      {/* Drawing tools */}
      {TOOLS.map((tool) => {
        const active = activeTool === tool.id;
        return (
          <React.Fragment key={tool.id}>
            <ButtonBase onClick={() => setActiveTool(tool.id)} data-tool={tool.id} sx={rowSx(active)}>
              <Box sx={{ color: active ? 'primary.main' : 'text.secondary', mt: 0.2, flexShrink: 0, display: 'flex' }}>
                {tool.icon}
              </Box>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
                  <Typography variant="caption" fontWeight={600} color={active ? 'primary.main' : 'text.primary'}>
                    {tool.name}
                  </Typography>
                  <ShortcutBadge k={tool.shortcut} />
                </Box>
                <Typography variant="caption" color="text.secondary" display="block"
                  sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                  {tool.description}
                </Typography>
              </Box>
            </ButtonBase>

            {/* AI Segmentation — prominently after Draw Mask */}
            {tool.id === 'polygon' && (
              <Button
                variant="contained"
                color="secondary"
                size="small"
                fullWidth
                startIcon={<AutoAwesomeIcon fontSize="small" />}
                onClick={onOpenCellposeConfig}
                disabled={isRunningCellpose}
                data-tool="cellpose"
                sx={{
                  textTransform: 'none', borderRadius: 1.5,
                  justifyContent: 'flex-start', px: 1.25, py: 0.7, my: 0.25,
                }}
              >
                <Box sx={{ textAlign: 'left', ml: 0.25 }}>
                  <Typography variant="caption" fontWeight={700} display="block" sx={{ lineHeight: 1.2 }}>
                    AI Pre-Segmentation
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ fontSize: '0.6rem', opacity: 0.85, lineHeight: 1.2 }}>
                    {modelLabel}
                  </Typography>
                </Box>
              </Button>
            )}

            {/* Save — prominently after Expand Mask */}
            {tool.id === 'expander' && (
              <Button
                variant="contained"
                color="success"
                size="small"
                fullWidth
                startIcon={<SaveIcon />}
                onClick={onSave}
                disabled={isSaving}
                data-tool="save"
                sx={{ textTransform: 'none', borderRadius: 1.5, justifyContent: 'flex-start', px: 1.25, py: 0.7, my: 0.25 }}
              >
                <Box sx={{ textAlign: 'left', ml: 0.25 }}>
                  <Typography variant="caption" fontWeight={700} display="block" sx={{ lineHeight: 1.2 }}>
                    {isSaving ? 'Saving…' : 'Save Annotation'}
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ fontSize: '0.6rem', opacity: 0.85, lineHeight: 1.2 }}>
                    Upload masks to cloud storage
                  </Typography>
                </Box>
              </Button>
            )}
          </React.Fragment>
        );
      })}

      <Divider sx={{ my: 0.5 }} />

      {/* View utilities */}
      <ButtonBase onClick={onResetView} data-tool="fit" sx={rowSx()}>
        <CenterFocusStrongIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.2, flexShrink: 0 }} />
        <Box>
          <Typography variant="caption" fontWeight={600} display="block">Fit to Image</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
            Reset the view to show the full image
          </Typography>
        </Box>
      </ButtonBase>

      <ButtonBase onClick={onToggleCLAHE} data-tool="clahe"
        sx={{ ...rowSx(isCLAHEActive), '&:hover': { bgcolor: isCLAHEActive ? 'rgba(25,118,210,0.10)' : 'rgba(0,0,0,0.04)' } }}>
        <ContrastIcon fontSize="small" sx={{ color: isCLAHEActive ? 'primary.main' : 'text.secondary', mt: 0.2, flexShrink: 0 }} />
        <Box>
          <Typography variant="caption" fontWeight={600} color={isCLAHEActive ? 'primary.main' : 'text.primary'} display="block">
            {isCLAHEActive ? 'Restore Original' : 'Enhance Contrast'}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
            CLAHE contrast enhancement
          </Typography>
        </Box>
      </ButtonBase>

      {/* Undo */}
      <ButtonBase onClick={onUndo} disabled={!canUndo} data-tool="undo" sx={rowSx()}>
        <UndoIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.2, flexShrink: 0 }} />
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
            <Typography variant="caption" fontWeight={600}>Undo</Typography>
            <ShortcutBadge k="Ctrl+Z" />
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
            Revert last annotation change
          </Typography>
        </Box>
      </ButtonBase>

      {/* Clear All */}
      <ButtonBase onClick={onClearAll} data-tool="clear"
        sx={{ ...rowSx(), '&:hover': { bgcolor: 'rgba(211,47,47,0.06)' } }}>
        <DeleteSweepIcon fontSize="small" sx={{ color: 'error.main', mt: 0.2, flexShrink: 0 }} />
        <Box>
          <Typography variant="caption" fontWeight={600} color="error.main" display="block">Clear All</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
            Remove all annotations on this image
          </Typography>
        </Box>
      </ButtonBase>

      <Divider sx={{ my: 0.5 }} />

      <ButtonBase onClick={onOpenMaskFilter} data-tool="filter" sx={rowSx()}>
        <FilterListIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.2, flexShrink: 0 }} />
        <Box>
          <Typography variant="caption" fontWeight={600} display="block">Filter Masks</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
            Remove masks below a minimum area
          </Typography>
        </Box>
      </ButtonBase>

      {/* File */}
      <ButtonBase onClick={() => fileInputRef.current?.click()} data-tool="upload" sx={rowSx()}>
        <UploadFileIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.2, flexShrink: 0 }} />
        <Box>
          <Typography variant="caption" fontWeight={600} display="block">Upload GeoJSON</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
            Import annotations from a file
          </Typography>
        </Box>
      </ButtonBase>
      {fileInput}

      {/* Image info */}
      {(imageName || (imageWidth && imageHeight)) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.4 }}>
          <InfoIcon sx={{ fontSize: '0.85rem', color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }} noWrap>
            {imageName}{imageWidth && imageHeight ? ` — ${imageWidth}×${imageHeight} px` : ''}
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1 }} />
      <Divider sx={{ my: 0.5 }} />

      {sessionUrl && (
        <Button
          variant="contained"
          size="small"
          fullWidth
          startIcon={<OpenInNewIcon fontSize="small" />}
          onClick={() => window.open(sessionUrl, '_blank', 'noopener,noreferrer')}
          data-tool="session"
          sx={{
            textTransform: 'none', borderRadius: 1.5, mb: 0.5,
            justifyContent: 'flex-start', px: 1.25, py: 0.65,
            bgcolor: '#0288d1', '&:hover': { bgcolor: '#0277bd' },
          }}
        >
          <Box sx={{ textAlign: 'left', ml: 0.25 }}>
            <Typography variant="caption" fontWeight={700} display="block" sx={{ lineHeight: 1.2 }}>
              Session Overview
            </Typography>
            <Typography variant="caption" display="block" sx={{ fontSize: '0.6rem', opacity: 0.88, lineHeight: 1.2 }}>
              Images, progress &amp; training
            </Typography>
          </Box>
        </Button>
      )}

      <ButtonBase onClick={onHelp} data-tool="help"
        sx={{ ...rowSx(), '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' } }}>
        <HelpOutlineIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.2, flexShrink: 0 }} />
        <Typography variant="caption" fontWeight={600}>Help & Tutorial</Typography>
      </ButtonBase>
    </Box>
  );
};

export default ToolBar;
