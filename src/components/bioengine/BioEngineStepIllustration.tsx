import React from 'react';
import './bioengine-landing.css';

/**
 * The three illustrations at the top of the step cards on `/bioengine`.
 *
 * Each one is a 16:9 inline SVG drawn in the site palette, with a reveal that
 * plays when the surrounding `.be-step-card` is hovered or keyboard-focused.
 * The motion itself lives in `bioengine-landing.css`; everything here is
 * geometry plus the class names that opt an element into the sequence.
 *
 * The resting state is the real state: every illustration has to read correctly
 * with no pointer anywhere near it, because that is how most people will see it
 * and it is also what readers with `prefers-reduced-motion` get.
 */

export type StepIllustrationVariant = 'setup' | 'admin' | 'apps';

/** Inline style carrying a CSS custom property, which `CSSProperties` cannot type. */
const cssVar = (name: string, value: string): React.CSSProperties =>
  ({ [name]: value } as React.CSSProperties);

/* -------------------------------------------------------------------------- */
/* 01 Set up a worker                                                          */
/* -------------------------------------------------------------------------- */

/* Power first, then the drive bays come up one by one, then the machine settles
   into an "online" glow. */
const LED_DELAYS = ['be-d3', 'be-d4', 'be-d5'];

/** One fan blade, repeated at 90 degree intervals. Four-fold symmetry keeps the
 *  bounding box centred on the hub, which is what the CSS rotation spins about. */
const FAN_BLADE = 'M0 0C1.4-6.4 7.6-8.8 10-5.1C12 -1.8 5.4-0.4 0 0Z';

const SetupIllustration: React.FC = () => (
  <svg viewBox="0 0 320 180" className="be-illu w-full h-auto" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="beSetupGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.32" />
        <stop offset="70%" stopColor="#3b82f6" stopOpacity="0.07" />
        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
      </radialGradient>
    </defs>

    <ellipse className="be-reveal be-d6" cx="160" cy="86" rx="122" ry="82" fill="url(#beSetupGlow)" />

    {/* Tower, kept tall and narrow with a tinted chassis so it reads as hardware
        rather than as a sheet of paper with a list on it. */}
    <rect x="124" y="148" width="14" height="6" rx="2" fill="#bfdbfe" />
    <rect x="182" y="148" width="14" height="6" rx="2" fill="#bfdbfe" />
    <rect x="96" y="156" width="128" height="3" rx="1.5" fill="#dbeafe" />

    <rect x="112" y="20" width="96" height="128" rx="12" fill="#f0f7ff" stroke="#93c5fd" strokeWidth="2" />

    {/* Vent grille across the top of the chassis. */}
    {Array.from({ length: 10 }).map((_, i) => (
      <rect key={`vent-${i}`} x={128 + i * 7} y="30" width="3" height="10" rx="1.5" fill="#bfdbfe" />
    ))}

    {/* Full-width drive bays, each with its own status LED and handle. */}
    {LED_DELAYS.map((delay, i) => {
      const y = 52 + i * 22;
      return (
        <g key={delay}>
          <rect x="124" y={y} width="72" height="16" rx="4" fill="#ffffff" stroke="#bfdbfe" strokeWidth="1.5" />
          <circle className={`be-reveal ${delay}`} cx="134" cy={y + 8} r="7.5" fill="#3b82f6" fillOpacity="0.22" />
          <circle className={`be-fade ${delay}`} cx="134" cy={y + 8} r="3.8" fill="#2563eb" />
          <rect x="184" y={y + 4} width="4" height="8" rx="2" fill="#bfdbfe" />
        </g>
      );
    })}

    {/* Chassis fan: the spin-up moment, attached to the machine. */}
    <circle cx="142" cy="130" r="13" fill="#ffffff" stroke="#bfdbfe" strokeWidth="1.5" />
    <g transform="translate(142 130)">
      <g className="be-fan">
        {[0, 90, 180, 270].map(angle => (
          <path key={angle} d={FAN_BLADE} transform={`rotate(${angle})`} fill="#93c5fd" />
        ))}
        <circle r="2.6" fill="#2563eb" />
      </g>
    </g>

    {/* Power button, with a ring breathing outward once the machine is up. */}
    <circle className="be-pulse" cx="182" cy="130" r="9.5" fill="none" stroke="#3b82f6" strokeWidth="2" />
    <circle cx="182" cy="130" r="9.5" fill="#ffffff" stroke="#bfdbfe" strokeWidth="1.5" />
    <g className="be-fade be-d1" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round">
      <path d="M185.4 127.6a4.6 4.6 0 11-6.8 0" />
      <path d="M182 124.2v4.6" />
    </g>
  </svg>
);

/* -------------------------------------------------------------------------- */
/* 02 Administer a worker                                                      */
/* -------------------------------------------------------------------------- */

const BARS = [
  { y: 78, full: '0.78', delay: 'be-d4' },
  { y: 100, full: '0.52', delay: 'be-d5' },
  { y: 122, full: '0.9', delay: 'be-d6' },
];

const AdminIllustration: React.FC = () => (
  <svg viewBox="0 0 320 180" className="be-illu w-full h-auto" aria-hidden="true" focusable="false">
    <rect x="30" y="26" width="260" height="124" rx="18" fill="#ffffff" stroke="#e9d5ff" strokeWidth="2" />

    <circle cx="50" cy="44" r="3.5" fill="#f3e8ff" />
    <circle cx="62" cy="44" r="3.5" fill="#f3e8ff" />
    <circle cx="74" cy="44" r="3.5" fill="#f3e8ff" />
    <rect x="90" y="40" width="72" height="8" rx="4" fill="#faf5ff" />
    <rect x="44" y="60" width="232" height="2" rx="1" fill="#f3e8ff" />

    {BARS.map(bar => (
      <g key={bar.y}>
        <rect x="44" y={bar.y} width="110" height="10" rx="5" fill="#f5f3ff" />
        <rect
          className={`be-bar-fill ${bar.delay}`}
          style={cssVar('--be-full', bar.full)}
          x="44"
          y={bar.y}
          width="110"
          height="10"
          rx="5"
          fill="#a855f7"
        />
      </g>
    ))}

    {/* Empty slot, then the application that drops into it. */}
    <rect x="176" y="72" width="96" height="60" rx="12" fill="none" stroke="#ede9fe" strokeWidth="2" strokeDasharray="5 5" />
    <g className="be-block be-d1">
      <rect x="176" y="72" width="96" height="60" rx="12" fill="#faf5ff" stroke="#c084fc" strokeWidth="2" />
      <rect x="190" y="88" width="46" height="7" rx="3.5" fill="#e9d5ff" />
      <rect x="190" y="103" width="66" height="7" rx="3.5" fill="#f3e8ff" />
      <circle cx="256" cy="91.5" r="4.5" fill="#a855f7" />
    </g>

    <g className="be-badge be-d8">
      <circle cx="272" cy="72" r="14" fill="#7c3aed" />
      <path
        d="M265.5 72.5l4.5 4.5 8.5-9.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  </svg>
);

/* -------------------------------------------------------------------------- */
/* 03 Use deployed apps                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Smooth closed blob through a ring of wobbled points, drawn as quadratic
 * curves between the midpoints of neighbouring points. Hand-written paths for
 * seven irregular cells would be unreadable, and perfect circles would not look
 * like cells.
 */
const blobPath = (cx: number, cy: number, radius: number, wobble: number[]): string => {
  const points = wobble.map((w, i) => {
    const angle = (i / wobble.length) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius * w, cy + Math.sin(angle) * radius * w];
  });
  const midpoint = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const round = (n: number) => n.toFixed(1);

  const start = midpoint(points[points.length - 1], points[0]);
  let d = `M ${round(start[0])} ${round(start[1])}`;
  points.forEach((point, i) => {
    const end = midpoint(point, points[(i + 1) % points.length]);
    d += ` Q ${round(point[0])} ${round(point[1])} ${round(end[0])} ${round(end[1])}`;
  });
  return `${d} Z`;
};

/** Delays follow the sweep, so an outline appears just after the line passes it.
 *
 *  Each wobble array has to vary *smoothly* around the ring and wrap back to its
 *  first value. Alternating high and low radii produces a rounded square, not a
 *  cell. One slow bulge per blob is what reads as organic.
 */
const CELLS = [
  { cx: 78, cy: 58, r: 24, wobble: [1.0, 1.1, 1.16, 1.08, 0.94, 0.84, 0.86, 0.94], tint: 0.3, delay: 'be-d3' },
  { cx: 92, cy: 126, r: 22, wobble: [0.92, 0.86, 0.9, 1.02, 1.14, 1.18, 1.1, 1.0], tint: 0.22, delay: 'be-d4' },
  { cx: 146, cy: 86, r: 28, wobble: [1.14, 1.06, 0.94, 0.86, 0.88, 0.98, 1.1, 1.16], tint: 0.3, delay: 'be-d6' },
  { cx: 190, cy: 44, r: 20, wobble: [0.88, 0.96, 1.08, 1.16, 1.12, 1.0, 0.9, 0.86], tint: 0.2, delay: 'be-d7' },
  { cx: 212, cy: 128, r: 25, wobble: [1.06, 1.14, 1.1, 0.98, 0.88, 0.86, 0.94, 1.02], tint: 0.26, delay: 'be-d8' },
  { cx: 252, cy: 72, r: 22, wobble: [0.9, 0.88, 0.98, 1.12, 1.18, 1.12, 0.98, 0.92], tint: 0.24, delay: 'be-d9' },
  { cx: 262, cy: 144, r: 16, wobble: [1.1, 1.0, 0.9, 0.86, 0.94, 1.06, 1.14, 1.16], tint: 0.18, delay: 'be-d10' },
].map(cell => ({ ...cell, d: blobPath(cell.cx, cell.cy, cell.r, cell.wobble) }));

const AppsIllustration: React.FC = () => (
  <svg viewBox="0 0 320 180" className="be-illu w-full h-auto" aria-hidden="true" focusable="false">
    <defs>
      <clipPath id="beAppsClip">
        <rect x="30" y="16" width="260" height="150" rx="14" />
      </clipPath>
      <linearGradient id="beAppsSweep" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
        <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.26" />
      </linearGradient>
    </defs>

    <rect x="30" y="16" width="260" height="150" rx="14" fill="#ecfeff" stroke="#a5f3fc" strokeWidth="2" />

    <g clipPath="url(#beAppsClip)">
      {CELLS.map(cell => (
        <path key={`fill-${cell.cx}-${cell.cy}`} d={cell.d} fill="#22d3ee" fillOpacity={cell.tint} />
      ))}

      {CELLS.map(cell => (
        <path
          key={`line-${cell.cx}-${cell.cy}`}
          className={`be-cell ${cell.delay}`}
          d={cell.d}
          fill="none"
          stroke="#0891b2"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      ))}

      {/* Travel distance is pinned to the `be-sweep` keyframe in the stylesheet. */}
      <g className="be-scan">
        <rect x="4" y="16" width="26" height="150" fill="url(#beAppsSweep)" />
        <rect x="30" y="16" width="2.5" height="150" fill="#06b6d4" />
      </g>
    </g>
  </svg>
);

/* -------------------------------------------------------------------------- */

const BioEngineStepIllustration: React.FC<{ variant: StepIllustrationVariant }> = ({ variant }) => {
  if (variant === 'setup') return <SetupIllustration />;
  if (variant === 'admin') return <AdminIllustration />;
  return <AppsIllustration />;
};

export default BioEngineStepIllustration;
