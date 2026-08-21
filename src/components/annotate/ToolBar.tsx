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
import ImagesearchRollerIcon from '@mui/icons-material/ImagesearchRoller';
import PolylineIcon from '@mui/icons-material/Polyline';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import {
  useAnnotationStore,
  AnnotationTool,
  MIN_BRUSH_RADIUS,
  MAX_BRUSH_RADIUS,
} from '../../store/annotationStore';
import { useResponsiveLayout } from './hooks/useResponsiveLayout';
import { usePanelExpansion } from './hooks/usePanelExpansion';
import { floatingPanelSx, floatingBtnSx, reducedMotionSx, iconSlotSx } from './floatingPanelStyles';

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
  { id: 'select',   name: 'Select',      shortcut: 'S', description: 'Click a mask to select it, or drag a box to select every mask it touches. Shift adds to the selection, Del deletes', icon: <NearMeIcon fontSize="small" /> },
  { id: 'polygon',  name: 'Draw Mask',   shortcut: 'D', description: 'Click to place vertices, double-click to close the polygon', icon: <PolylineIcon fontSize="small" /> },
  { id: 'cutter',   name: 'Cut Mask',    shortcut: 'C', description: 'Draw a line across an existing mask to split it',          icon: <ContentCutIcon fontSize="small" /> },
  { id: 'eraser',   name: 'Eraser',      shortcut: 'E', description: 'Paint to remove areas from an existing mask',              icon: <AutoFixOffIcon fontSize="small" /> },
  { id: 'expander', name: 'Expand Mask', shortcut: 'A', description: 'Paint to add area to an existing mask',                    icon: <ImagesearchRollerIcon fontSize="small" /> },
  // AI tools stay last, rendered after a divider and given a subtler shared
  // highlight so they read as a matched pair (see the `expander` injection
  // below for the Full Image Segmentation button that precedes this one).
  { id: 'sambox',   name: 'Interactive Segmentation', shortcut: 'B', description: 'Draw a box around a cell for a one-click AI mask', icon: <HighlightAltIcon fontSize="small" />, requiresMicroSam: true },
];

// Shared, generalized description of the AI backend, deliberately model-agnostic
// since the available models change over time: used for the Full Image
// Segmentation subtitle.
const AI_BACKEND_DESCRIPTION = 'Select your model for automatic segmentation';

// Subtle shared tint for the AI tool pair (Full Image Segmentation button +
// Interactive Segmentation tool row), less heavy than a solid fill.
const aiTintSx = (active: boolean, dim = false) => ({
  bgcolor: active ? 'rgba(156,39,176,0.16)' : dim ? undefined : 'rgba(156,39,176,0.07)',
  '&:hover': { bgcolor: active ? 'rgba(156,39,176,0.16)' : dim ? undefined : 'rgba(156,39,176,0.13)' },
});

export interface ToolBarProps {
  onOpenCellposeConfig: () => void;
  /** Opens the Interactive Segmentation model-selection dialog. Clicking the
   *  tool button always opens this dialog, ready or not (round 34b: no
   *  separate configure affordance). The keyboard shortcut (B) still
   *  activates the tool directly when it's ready and only falls back to the
   *  dialog when it isn't. */
  onOpenSamBoxConfig: () => void;
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
  onOpenSamBoxConfig,
  cellposeConfigOpen = false,
  cellposeAvailable = false, microSamAvailable = false,
  aiBoxReady = false,
  isRunningCellpose,
  disabled = false,
}) => {
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const drawMode = useAnnotationStore((s) => s.drawMode);
  const setDrawMode = useAnnotationStore((s) => s.setDrawMode);
  const brushRadius = useAnnotationStore((s) => s.brushRadius);
  const increaseBrushRadius = useAnnotationStore((s) => s.increaseBrushRadius);
  const decreaseBrushRadius = useAnnotationStore((s) => s.decreaseBrushRadius);

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

  // Full Image Segmentation only needs one of the two backends up. It's
  // disabled solely when both the Cellpose-SAM and μSAM services are down.
  const segmentationUnavailable = !cellposeAvailable && !microSamAvailable;

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
            const toolNotReady = !!tool.requiresMicroSam && microSamAvailable && !aiBoxReady;
            const toolDisabled = toolUnavailable;
            const isPolygon = tool.id === 'polygon';
            const isSambox = tool.id === 'sambox';
            const toolIcon = isPolygon && drawMode === 'brush' ? <BrushIcon fontSize="small" /> : tool.icon;
            return (
              <React.Fragment key={tool.id}>
                <Tooltip
                  title={toolUnavailable
                    ? `${tool.name} unavailable (the micro-sam segmentation service is offline)`
                    : toolNotReady
                    ? `${tool.name}. Click to choose a model.`
                    : `${tool.name} (${tool.shortcut})`}
                  placement={tooltipPlacement}
                >
                  <span>
                    <IconButton
                      size={btnSize}
                      data-tool={tool.id}
                      onClick={() => (isSambox ? onOpenSamBoxConfig() : setActiveTool(tool.id))}
                      onDoubleClick={isPolygon ? () => setDrawMode(drawMode === 'brush' ? 'lasso' : 'brush') : undefined}
                      disabled={toolDisabled}
                      aria-label={tool.name}
                      sx={{
                        ...floatingBtnSx(activeTool === tool.id),
                        flexShrink: 0,
                        ...(isSambox ? aiTintSx(activeTool === 'sambox', toolDisabled) : {}),
                        ...touchSx,
                      }}
                    >
                      {toolIcon}
                    </IconButton>
                  </span>
                </Tooltip>

                {/* AI pair sits at the bottom, below Expand Mask, behind a divider */}
                {tool.id === 'expander' && (
                  <>
                    <Divider flexItem orientation={isPortrait ? 'vertical' : 'horizontal'} sx={{ opacity: 0.35 }} />
                    <Tooltip
                      title={segmentationUnavailable ? 'Segmentation services are currently unavailable' : `Full Image Segmentation: ${AI_BACKEND_DESCRIPTION}`}
                      placement={tooltipPlacement}
                    >
                      <span>
                        <IconButton
                          size={btnSize}
                          data-tool="cellpose"
                          onClick={onOpenCellposeConfig}
                          disabled={isRunningCellpose || segmentationUnavailable}
                          aria-label="Full Image Segmentation"
                          sx={{
                            ...floatingBtnSx(cellposeConfigOpen),
                            flexShrink: 0,
                            ...aiTintSx(cellposeConfigOpen, segmentationUnavailable),
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
            const isSambox = tool.id === 'sambox';
            // Only truly offline is fully inert; clicking otherwise always
            // opens the model dialog for sambox (round 34b: no separate
            // configure affordance), so nothing else needs to stay pending.
            const toolDisabled = toolUnavailable;
            const isPolygon = tool.id === 'polygon';
            const toolIcon = isPolygon && drawMode === 'brush' ? <BrushIcon fontSize="small" /> : tool.icon;
            const toolDescription = isPolygon
              ? (drawMode === 'brush'
                ? 'Paint with a circular brush along the mask edge. Double-click this button for lasso mode.'
                : 'Click to place vertices, double-click on the canvas to close. Double-click this button for brush mode.')
              : tool.description;
            return (
              <React.Fragment key={tool.id}>
                <Tooltip
                  title={toolUnavailable ? 'The micro-sam segmentation service is currently offline' : ''}
                  placement="right"
                  disableHoverListener={!toolUnavailable}
                >
                  <span style={{ width: '100%', display: 'flex' }}>
                    <ButtonBase
                      onClick={() => (isSambox ? onOpenSamBoxConfig() : setActiveTool(tool.id))}
                      onDoubleClick={isPolygon ? () => setDrawMode(drawMode === 'brush' ? 'lasso' : 'brush') : undefined}
                      data-tool={tool.id}
                      disabled={toolDisabled}
                      aria-label={tool.name}
                      sx={{
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1,
                        px: 1, py: isCompact ? 1 : 0.7, borderRadius: 1.5, flex: 1, minWidth: 0, textAlign: 'left',
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
                        {toolIcon}
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
                          {toolDescription}
                        </Typography>
                      </Box>
                    </ButtonBase>
                  </span>
                </Tooltip>

                {/* Radius stepper, right below Draw Mask, only while brush mode is active */}
                {isPolygon && drawMode === 'brush' && (
                  <Box sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    px: 1, py: 0.4, ml: 4.5,
                  }}>
                    <IconButton
                      size="small"
                      onClick={() => decreaseBrushRadius()}
                      disabled={brushRadius <= MIN_BRUSH_RADIUS}
                      aria-label="Decrease brush radius"
                      sx={{ ...floatingBtnSx(), width: 26, height: 26 }}
                    >
                      <RemoveIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                      {brushRadius}px
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => increaseBrushRadius()}
                      disabled={brushRadius >= MAX_BRUSH_RADIUS}
                      aria-label="Increase brush radius"
                      sx={{ ...floatingBtnSx(), width: 26, height: 26 }}
                    >
                      <AddIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                )}

                {/* AI pair at the bottom, below Expand Mask, behind a divider */}
                {tool.id === 'expander' && (
                  <>
                    <Divider sx={{ my: 0.4, opacity: 0.5 }} />
                    <Tooltip
                      title={segmentationUnavailable ? 'Segmentation services are currently unavailable' : ''}
                      placement="right"
                      disableHoverListener={!segmentationUnavailable}
                    >
                      <span style={{ width: '100%' }}>
                        <ButtonBase
                          onClick={onOpenCellposeConfig}
                          disabled={isRunningCellpose || segmentationUnavailable}
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
                            opacity: (isRunningCellpose || segmentationUnavailable) ? 0.5 : 1,
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
                              {segmentationUnavailable ? 'Service offline' : AI_BACKEND_DESCRIPTION}
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
