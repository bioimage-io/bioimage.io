import React from 'react';
import {
  IconButton,
  Tooltip,
  Box,
  Typography,
  Divider,
  ButtonBase,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import NearMeIcon from '@mui/icons-material/NearMe';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import BrushIcon from '@mui/icons-material/Brush';
import PolylineIcon from '@mui/icons-material/Polyline';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import { useAnnotationStore, AnnotationTool } from '../../store/annotationStore';
import { useResponsiveLayout } from './hooks/useResponsiveLayout';
import { usePanelExpansion } from './hooks/usePanelExpansion';
import { floatingPanelSx, floatingBtnSx, reducedMotionSx, ToolSpinner, iconSlotSx } from './floatingPanelStyles';

interface ToolDef {
  id: AnnotationTool;
  name: string;
  shortcut: string;
  description: string;
  icon: React.ReactNode;
  /** Tool depends on the μSAM service; disabled + explained when it is offline. */
  requiresMicroSam?: boolean;
}

// Segmentation tools first (mode selectors), then edit tools. New prompt-style
// tools (point/scribble) slot in here as additional entries — no placeholders
// are added ahead of time.
const TOOLS: ToolDef[] = [
  { id: 'move',     name: 'Move',        shortcut: 'M', description: 'Pan and navigate the image',                              icon: <OpenWithIcon fontSize="small" /> },
  { id: 'select',   name: 'Select',      shortcut: 'S', description: 'Click a mask to select it; Shift for multi, Del to delete', icon: <NearMeIcon fontSize="small" /> },
  { id: 'polygon',  name: 'Draw Mask',   shortcut: 'D', description: 'Click to place vertices, double-click to close the polygon', icon: <PolylineIcon fontSize="small" /> },
  { id: 'cutter',   name: 'Cut Mask',    shortcut: 'C', description: 'Draw a line across an existing mask to split it',          icon: <ContentCutIcon fontSize="small" /> },
  { id: 'eraser',   name: 'Eraser',      shortcut: 'E', description: 'Paint to remove areas from an existing mask',              icon: <AutoFixOffIcon fontSize="small" /> },
  { id: 'expander', name: 'Expand Mask', shortcut: 'A', description: 'Paint to add area to an existing mask',                    icon: <BrushIcon fontSize="small" /> },
  // AI tools stay last, rendered after a divider and given a subtler shared
  // highlight so they read as a matched pair (see the `expander` injection
  // below for the Full Image Segmentation button that precedes this one).
  { id: 'sambox',   name: 'Interactive Segmentation', shortcut: 'B', description: 'Draw a box around a cell for a one-click AI mask', icon: <HighlightAltIcon fontSize="small" />, requiresMicroSam: true },
];

// Shared, generalized description of the AI backend (not Cellpose-specific):
// used for the Full Image Segmentation subtitle.
const AI_BACKEND_DESCRIPTION = 'AI backend: Cellpose4 models (Cellpose-SAM now, Cellpose-DINO coming), or μSAM AIS';

// Subtle shared tint for the AI tool pair (Full Image Segmentation button +
// Interactive Segmentation tool row), less heavy than a solid fill.
const aiTintSx = (active: boolean, dim = false) => ({
  bgcolor: active ? 'rgba(156,39,176,0.16)' : dim ? undefined : 'rgba(156,39,176,0.07)',
  '&:hover': { bgcolor: active ? 'rgba(156,39,176,0.16)' : dim ? undefined : 'rgba(156,39,176,0.13)' },
});

export interface ToolBarProps {
  onOpenCellposeConfig: () => void;
  /** True while the Full Image Segmentation dialog is open, used to mark
   *  the AI pair "active" the same way a selected tool is. */
  cellposeConfigOpen?: boolean;
  cellposeAvailable?: boolean;
  microSamAvailable?: boolean;
  /** True once the μSAM embedding + ONNX decoder are both warmed up and the
   * AI Box tool will actually respond to a drawn box, not just "reachable". */
  aiBoxReady?: boolean;
  isRunningCellpose: boolean;
  /** True while the page has no viewable session (access denied or login
   * required, colab-rework-plan.md §19 item 10): dims the whole panel and
   * blocks interaction so it reads as non-interactive rather than just
   * being covered up. */
  disabled?: boolean;
}

const ToolBar: React.FC<ToolBarProps> = ({
  onOpenCellposeConfig,
  cellposeConfigOpen = false,
  cellposeAvailable = false, microSamAvailable = false,
  aiBoxReady = false,
  isRunningCellpose,
  disabled = false,
}) => {
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);

  const { isPortrait, isCompact } = useResponsiveLayout();

  const isExpanded = usePanelExpansion((s) => s.toolsExpanded);
  const setToolsExpanded = usePanelExpansion((s) => s.setToolsExpanded);

  // Auto-collapse once, the first time the panel becomes compact (e.g. after
  // an orientation change), without fighting a manual re-expand afterward.
  const wasAutoCollapsed = React.useRef(false);
  React.useEffect(() => {
    if (isCompact && isExpanded && !wasAutoCollapsed.current) {
      wasAutoCollapsed.current = true;
      setToolsExpanded(false, isPortrait);
    }
  }, [isCompact]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = () => {
    wasAutoCollapsed.current = false;
    setToolsExpanded(!isExpanded, isPortrait);
  };

  // Minimum 44px touch target on phones/tablets.
  const btnSize = isCompact ? 'medium' : 'small';
  const touchSx = isCompact ? { minWidth: 44, minHeight: 44 } : {};

  // Floating placement: left edge in landscape, top edge in portrait.
  const anchorSx = isPortrait
    ? { top: 'calc(var(--annotate-header-h) + 10px)', left: 12, right: 12 }
    : { top: 'calc(var(--annotate-header-h) + 12px)', left: 12, bottom: 12 };

  const tooltipPlacement = isPortrait ? 'bottom' : 'right';

  return (
    <Box
      role="toolbar"
      aria-label="Annotation tools"
      aria-disabled={disabled}
      sx={{
        position: 'absolute',
        zIndex: 1000,
        ...anchorSx,
        display: 'flex',
        alignItems: 'flex-start',
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
          <Tooltip title="Expand toolbar" placement={tooltipPlacement}>
            <IconButton
              size={btnSize}
              onClick={toggleExpanded}
              aria-label="Expand toolbar"
              sx={{ ...floatingBtnSx(), flexShrink: 0, ...touchSx }}
            >
              {isPortrait ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          <Divider flexItem orientation={isPortrait ? 'vertical' : 'horizontal'} sx={{ opacity: 0.35 }} />

          {TOOLS.map((tool) => {
            const toolUnavailable = !!tool.requiresMicroSam && !microSamAvailable;
            const toolPending = !!tool.requiresMicroSam && microSamAvailable && !aiBoxReady;
            const toolDisabled = toolUnavailable || toolPending;
            return (
              <React.Fragment key={tool.id}>
                <Tooltip
                  title={toolUnavailable
                    ? `${tool.name} unavailable (μSAM service is offline)`
                    : toolPending
                    ? `${tool.name} is warming up...`
                    : `${tool.name} (${tool.shortcut})`}
                  placement={tooltipPlacement}
                >
                  <span>
                    <IconButton
                      size={btnSize}
                      data-tool={tool.id}
                      onClick={() => setActiveTool(tool.id)}
                      disabled={toolDisabled}
                      aria-label={tool.name}
                      sx={{
                        ...floatingBtnSx(activeTool === tool.id),
                        flexShrink: 0,
                        ...(tool.id === 'sambox' ? aiTintSx(activeTool === 'sambox', toolDisabled) : {}),
                        ...touchSx,
                      }}
                    >
                      {toolPending ? <ToolSpinner size={isCompact ? 20 : 18} /> : tool.icon}
                    </IconButton>
                  </span>
                </Tooltip>

                {/* AI pair sits at the bottom, below Expand Mask, behind a divider */}
                {tool.id === 'expander' && (
                  <>
                    <Divider flexItem orientation={isPortrait ? 'vertical' : 'horizontal'} sx={{ opacity: 0.35 }} />
                    <Tooltip
                      title={cellposeAvailable ? `Full Image Segmentation: ${AI_BACKEND_DESCRIPTION}` : 'Full Image Segmentation unavailable (cellpose service is offline)'}
                      placement={tooltipPlacement}
                    >
                      <span>
                        <IconButton
                          size={btnSize}
                          data-tool="cellpose"
                          onClick={onOpenCellposeConfig}
                          disabled={isRunningCellpose || !cellposeAvailable}
                          aria-label="Full Image Segmentation"
                          sx={{
                            ...floatingBtnSx(cellposeConfigOpen),
                            flexShrink: 0,
                            ...aiTintSx(cellposeConfigOpen, !cellposeAvailable),
                            color: cellposeConfigOpen ? 'secondary.main' : undefined,
                            ...touchSx,
                          }}
                        >
                          <AutoAwesomeIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                )}
              </React.Fragment>
            );
          })}
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
          {/* Header with collapse button */}
          <Box
            component="button"
            type="button"
            onClick={toggleExpanded}
            aria-label="Collapse toolbar"
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
            <Typography variant="caption" sx={{
              fontWeight: 700, color: 'text.disabled',
              textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.58rem', flex: 1,
              textAlign: 'left',
            }}>
              Annotation Tools
            </Typography>
            {isPortrait ? <ExpandLessIcon sx={{ fontSize: 16, color: 'text.disabled' }} /> : <ChevronLeftIcon sx={{ fontSize: 16, color: 'text.disabled' }} />}
          </Box>

          {TOOLS.map((tool) => {
            const active = activeTool === tool.id;
            const toolUnavailable = !!tool.requiresMicroSam && !microSamAvailable;
            const toolPending = !!tool.requiresMicroSam && microSamAvailable && !aiBoxReady;
            const toolDisabled = toolUnavailable || toolPending;
            return (
              <React.Fragment key={tool.id}>
                <Tooltip
                  title={toolUnavailable ? 'μSAM service is currently offline' : toolPending ? 'Warming up (loading embedding + decoder)...' : ''}
                  placement="right"
                  disableHoverListener={!toolDisabled}
                >
                  <span style={{ width: '100%' }}>
                    <ButtonBase
                      onClick={() => setActiveTool(tool.id)}
                      data-tool={tool.id}
                      disabled={toolDisabled}
                      aria-label={tool.name}
                      sx={{
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
                        px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
                        bgcolor: active ? (tool.id === 'sambox' ? 'rgba(156,39,176,0.14)' : 'rgba(25,118,210,0.10)')
                          : tool.id === 'sambox' ? 'rgba(156,39,176,0.06)' : 'transparent',
                        border: '1px solid',
                        borderColor: active ? (tool.id === 'sambox' ? 'rgba(156,39,176,0.3)' : 'rgba(25,118,210,0.25)') : 'transparent',
                        '&:hover': { bgcolor: active ? (tool.id === 'sambox' ? 'rgba(156,39,176,0.18)' : 'rgba(25,118,210,0.14)') : tool.id === 'sambox' ? 'rgba(156,39,176,0.11)' : 'rgba(0,0,0,0.05)' },
                        transition: 'background-color 140ms ease, transform 140ms ' + 'cubic-bezier(0.23, 1, 0.32, 1)',
                        '&:active': { transform: 'scale(0.98)' },
                        opacity: toolDisabled ? 0.5 : 1,
                        minHeight: isCompact ? 48 : undefined,
                        touchAction: 'manipulation',
                        ...reducedMotionSx,
                      }}
                    >
                      <Box sx={{ ...iconSlotSx, color: active ? (tool.id === 'sambox' ? 'secondary.main' : 'primary.main') : 'text.secondary', mt: 0.2 }}>
                        {toolPending ? <ToolSpinner size={18} /> : tool.icon}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.6 }}>
                          <Typography variant="caption" fontWeight={600} color={active ? (tool.id === 'sambox' ? 'secondary.main' : 'primary.main') : 'text.primary'}
                            data-testid="row-title"
                            sx={{ minWidth: 0 }}>
                            {tool.name}
                          </Typography>
                          {!isCompact && (
                            <Typography component="span" sx={{
                              fontSize: '0.58rem', color: 'text.disabled', fontFamily: 'monospace',
                              bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5, lineHeight: 1.6,
                              flexShrink: 0, mt: 0.15,
                            }}>{tool.shortcut}</Typography>
                          )}
                        </Box>
                        <Typography variant="caption" color="text.secondary" display="block"
                          sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                          {tool.description}
                        </Typography>
                      </Box>
                    </ButtonBase>
                  </span>
                </Tooltip>

                {/* AI pair at the bottom, below Expand Mask, behind a divider */}
                {tool.id === 'expander' && (
                  <>
                    <Divider sx={{ my: 0.4, opacity: 0.5 }} />
                    <Tooltip
                      title={cellposeAvailable ? '' : 'Cellpose service is currently offline'}
                      placement="right"
                      disableHoverListener={cellposeAvailable}
                    >
                      <span style={{ width: '100%' }}>
                        <ButtonBase
                          onClick={onOpenCellposeConfig}
                          disabled={isRunningCellpose || !cellposeAvailable}
                          data-tool="cellpose"
                          aria-label="Full Image Segmentation"
                          sx={{
                            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
                            px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, width: '100%', textAlign: 'left',
                            bgcolor: cellposeConfigOpen ? 'rgba(156,39,176,0.14)' : 'rgba(156,39,176,0.06)',
                            border: '1px solid', borderColor: cellposeConfigOpen ? 'rgba(156,39,176,0.3)' : 'rgba(156,39,176,0.18)',
                            '&:hover': { bgcolor: cellposeConfigOpen ? 'rgba(156,39,176,0.18)' : 'rgba(156,39,176,0.11)' },
                            transition: 'background-color 140ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
                            '&:active': { transform: 'scale(0.98)' },
                            opacity: (isRunningCellpose || !cellposeAvailable) ? 0.5 : 1,
                            minHeight: isCompact ? 48 : undefined,
                            touchAction: 'manipulation',
                            ...reducedMotionSx,
                          }}
                        >
                          <Box sx={{ ...iconSlotSx, color: cellposeConfigOpen ? 'secondary.main' : 'text.secondary', mt: 0.2 }}>
                            <AutoAwesomeIcon fontSize="small" />
                          </Box>
                          <Box>
                            <Typography variant="caption" fontWeight={600} color={cellposeConfigOpen ? 'secondary.main' : 'text.primary'} display="block"
                              data-testid="row-title">
                              Full Image Segmentation
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block"
                              sx={{ fontSize: '0.63rem', lineHeight: 1.3, mt: 0.1 }}>
                              {cellposeAvailable ? AI_BACKEND_DESCRIPTION : 'Service offline'}
                            </Typography>
                          </Box>
                        </ButtonBase>
                      </span>
                    </Tooltip>
                  </>
                )}
              </React.Fragment>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default ToolBar;
