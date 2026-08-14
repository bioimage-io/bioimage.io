import { useMediaQuery, useTheme } from '@mui/material';

/**
 * Orientation-aware layout signals for the annotate page's floating panels.
 * `isPortrait` drives panel placement (top/bottom edge vs. left/right edge);
 * `isCompact` (width-only, same threshold the page previously called
 * `isMobile`) drives touch target sizing and the default collapsed state.
 * Kept as a shared hook since both the tools panel and the actions panel
 * need to agree on placement.
 */
export function useResponsiveLayout() {
  const theme = useTheme();
  const isPortrait = useMediaQuery('(orientation: portrait)');
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  return { isPortrait, isCompact };
}
