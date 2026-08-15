import React from 'react';
import { Box } from '@mui/material';

// Shared visual language for the annotate page's floating panels (tools,
// actions): blur-backed translucent card, transform/opacity-only
// transitions, and press feedback via scale (emil-design-eng guidance).

export const FLOAT_EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export const floatingPanelSx = {
  background: 'rgba(255,255,255,0.7)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.6)',
  borderRadius: 3,
  boxShadow: '0 4px 24px rgba(15,23,42,0.16)',
};

// Fixed-size slot every row icon renders inside, so icons with different
// internal glyph padding still present the same left edge and baseline.
export const iconSlotSx = {
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

// Edge-fade mask hinting that a collapsed icon strip scrolls further in that
// direction (narrow phones can't fit every tool/action in one screen-width).
export const scrollFadeSx = (direction: 'horizontal' | 'vertical') => {
  const gradient = direction === 'horizontal'
    ? 'linear-gradient(to right, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)'
    : 'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)';
  return { maskImage: gradient, WebkitMaskImage: gradient };
};

// Shared reduced-motion override: honor the OS-level setting by dropping
// transitions/press-scale entirely rather than just shortening them.
export const reducedMotionSx = {
  '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:active': { transform: 'none' } },
};

export const floatingBtnSx = (active = false) => ({
  borderRadius: 1.5,
  bgcolor: active ? 'primary.main' : 'transparent',
  color: active ? 'white' : 'inherit',
  transition: `transform 140ms ${FLOAT_EASE_OUT}, background-color 140ms ease`,
  touchAction: 'manipulation',
  '&:hover': { bgcolor: active ? 'primary.dark' : 'rgba(0,0,0,0.06)' },
  '&:active': { transform: 'scale(0.94)' },
  '&.Mui-disabled': { opacity: 0.4 },
  ...reducedMotionSx,
});

// Small spinner shown on a tool icon while it's warming up (service reachable
// but its embedding/decoder prep isn't done yet).
export const ToolSpinner: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <Box
    component="svg"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    sx={{
      width: size,
      height: size,
      animation: 'floating-panel-spin 0.8s linear infinite',
      '@keyframes floating-panel-spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
    }}
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity={0.25} />
    <path
      fill="currentColor"
      opacity={0.75}
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </Box>
);
