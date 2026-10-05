import React from 'react';
import './bioengine-landing.css';

/**
 * The "How BioEngine works" diagram on `/bioengine`.
 *
 * Four columns: the biologist, the clients they work through, the public Hypha
 * server, and the distributed workers. Everything is drawn here in the site's
 * own visual language (thin strokes, rounded rectangles, the blue to purple to
 * cyan accents, gray labels) rather than imported as an image, so it scales,
 * picks up the page font, and stays editable. The one exception is the Hypha
 * mark itself, which is the official artwork served from `public/static/img/`.
 *
 * Two renderings, not one. The wide SVG carries real labels at a readable size
 * but only down to about 700px, below which its text would scale to roughly 5px.
 * Rather than make small screens scroll sideways past unreadable type, narrow
 * viewports get a stacked flow built from ordinary elements that says the same
 * thing in the same visual language. `md` is the switch for both.
 *
 * The connectors carry a slow dash flow to suggest live traffic. It is ambient
 * on purpose and is switched off entirely under `prefers-reduced-motion`.
 */

const HYPHA_LOGO = '/static/img/hypha-icon-black.svg';

const DIAGRAM_SUMMARY =
  'A biologist works through AI agents, web clients and desktop clients, which all connect to one public Hypha server hosted at KTH in Stockholm, Sweden. Hypha routes the work to distributed BioEngine workers, each running Ray, on a laptop, a workstation or an institutional cluster managed with Kubernetes or SLURM.';

/*
 * Geometry. Every box in the wide rendering derives from these, so the four
 * columns keep an equal 48 unit horizontal gap, the two outer columns keep an
 * equal 28 unit vertical gap, and the biologist, the middle client, Hypha and
 * the middle worker all sit on one midline. Change a constant, not a coordinate.
 */
const MID_Y = 210;
const BOX_H = 76;
const V_GAP = 28;
/** Row centres, derived so the middle row lands exactly on the midline. */
const ROWS = [MID_Y - (BOX_H + V_GAP), MID_Y, MID_Y + (BOX_H + V_GAP)];

const BIO_CX = 49;
const BIO_R = 26;
const CLIENT_X = 123;
const CLIENT_W = 164;
const HYPHA_X = 335;
const HYPHA_W = 264;
const HYPHA_H = 124;
const WORKER_X = 647;
const WORKER_W = 280;

const HYPHA_MID_X = HYPHA_X + HYPHA_W / 2;
/** The slate panel sits 12 units outside the worker cards on every side. */
const PANEL_X = WORKER_X - 12;
const PANEL_W = WORKER_W + 24;
const PANEL_Y = ROWS[0] - BOX_H / 2 - 12;
const PANEL_H = ROWS[2] - ROWS[0] + BOX_H + 24;

const VIEW_BOX = '0 24 960 356';

const CLIENTS: { label: string; tone: string }[] = [
  { label: 'AI agents', tone: '#2563eb' },
  { label: 'Web clients', tone: '#7c3aed' },
  { label: 'Desktop clients', tone: '#0891b2' },
];

const WORKERS: { name: string; chips: string[] }[] = [
  { name: 'Laptop', chips: ['Ray'] },
  { name: 'Workstation', chips: ['Ray'] },
  { name: 'Institutional cluster', chips: ['Ray', 'Kubernetes', 'SLURM'] },
];

/** Connector colours. Light enough to sit behind the nodes, dark enough that the
 *  flow animation is actually visible against white. */
const FLOW = '#94a3b8';
const FLOW_SOFT = '#cbd5e1';

type GlyphKind = 'biologist' | 'agent' | 'web' | 'desktop' | 'laptop' | 'workstation' | 'cluster';

/* -------------------------------------------------------------------------- */
/* Wide rendering                                                              */
/* -------------------------------------------------------------------------- */

/** Client glyph, drawn in a 24 unit box whose origin the caller positions. */
const ClientGlyph: React.FC<{ index: number; cy: number; tone: string }> = ({ index, cy, tone }) => {
  const stroke = {
    fill: 'none',
    stroke: tone,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (index === 0) {
    return (
      <g transform={`translate(143 ${cy - 12})`} {...stroke}>
        <rect x="1" y="7" width="22" height="16" rx="5" />
        <path d="M12 7V3" />
        <circle cx="12" cy="2" r="1.6" fill={tone} stroke="none" />
        <circle cx="8" cy="15" r="1.9" fill={tone} stroke="none" />
        <circle cx="16" cy="15" r="1.9" fill={tone} stroke="none" />
      </g>
    );
  }

  if (index === 1) {
    return (
      <g transform={`translate(143 ${cy - 12})`} {...stroke}>
        <rect x="1" y="3" width="22" height="18" rx="3" />
        <path d="M1 9.5h22" />
        <circle cx="5" cy="6.2" r="1.1" fill={tone} stroke="none" />
        <circle cx="9" cy="6.2" r="1.1" fill={tone} stroke="none" />
      </g>
    );
  }

  return (
    <g transform={`translate(143 ${cy - 12})`} {...stroke}>
      <rect x="1" y="2" width="22" height="15" rx="2.5" />
      <path d="M9 17v3M15 17v3M7 20h10" />
    </g>
  );
};

/** Worker glyph. Each one carries its own vertical offset so that whatever its
 *  natural height, it ends up centred on the row. */
const WorkerGlyph: React.FC<{ index: number; cy: number }> = ({ index, cy }) => {
  const stroke = {
    fill: 'none',
    stroke: '#6b7280',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (index === 0) {
    return (
      <g transform={`translate(665 ${cy - 12})`} {...stroke}>
        <rect x="2" y="0" width="28" height="19" rx="2.5" />
        <path d="M0 24h32" />
      </g>
    );
  }

  if (index === 1) {
    return (
      <g transform={`translate(665 ${cy - 14})`} {...stroke}>
        <rect x="1" y="0" width="30" height="21" rx="2.5" />
        <path d="M12 21v6M20 21v6M8 27h16" />
      </g>
    );
  }

  return (
    <g transform={`translate(665 ${cy - 17})`} {...stroke}>
      <rect x="1" y="0" width="30" height="14" rx="3" />
      <rect x="1" y="20" width="30" height="14" rx="3" />
      <circle cx="8" cy="7" r="1.6" fill="#6b7280" stroke="none" />
      <circle cx="8" cy="27" r="1.6" fill="#6b7280" stroke="none" />
      <path d="M14 7h12M14 27h12" />
    </g>
  );
};

/** Rounded pill used for the Ray, Kubernetes and SLURM wordmarks. */
const CHIP_LAYOUT: Record<string, { x: number; w: number }> = {
  Ray: { x: 711, w: 48 },
  Kubernetes: { x: 766, w: 82 },
  SLURM: { x: 855, w: 60 },
};

const Chip: React.FC<{ label: string; cy: number }> = ({ label, cy }) => {
  const { x, w } = CHIP_LAYOUT[label];
  const ray = label === 'Ray';
  return (
    <g>
      <rect
        x={x}
        y={cy}
        width={w}
        height="22"
        rx="11"
        fill={ray ? '#eff6ff' : '#f1f5f9'}
        stroke={ray ? '#bfdbfe' : '#e2e8f0'}
        strokeWidth="1.2"
      />
      <text
        x={x + w / 2}
        y={cy + 15}
        textAnchor="middle"
        fontSize="12"
        fontWeight="600"
        fill={ray ? '#1d4ed8' : '#475569'}
      >
        {label}
      </text>
    </g>
  );
};

const ArchitectureSvg: React.FC = () => (
  <svg viewBox={VIEW_BOX} className="w-full h-auto" role="img" aria-label={DIAGRAM_SUMMARY}>
    {/* ---- column headings ---- */}
    <text x={CLIENT_X + CLIENT_W / 2} y="46" textAnchor="middle" fontSize="14" fontWeight="600" fill="#374151">
      Clients and agents
    </text>
    <text x={PANEL_X + PANEL_W / 2} y="46" textAnchor="middle" fontSize="14" fontWeight="600" fill="#374151">
      Distributed workers
    </text>

    {/* ---- biologist ---- */}
    <circle cx={BIO_CX} cy={MID_Y} r={BIO_R} fill="#ffffff" stroke="#e5e7eb" strokeWidth="1.5" />
    <circle cx={BIO_CX} cy={MID_Y - 7} r="7.5" fill="#94a3b8" />
    <path d={`M${BIO_CX - 12.5} ${MID_Y + 14}a12.5 12.5 0 0125 0z`} fill="#94a3b8" />
    <text x={BIO_CX} y={MID_Y + 44} textAnchor="middle" fontSize="13" fill="#6b7280">
      Biologist
    </text>

    <path d="M68 192C92 168 98 124 123 106" fill="none" stroke={FLOW_SOFT} strokeWidth="2" strokeDasharray="4 5" />
    <path d="M75 210H123" fill="none" stroke={FLOW_SOFT} strokeWidth="2" strokeDasharray="4 5" />
    <path d="M68 228C92 252 98 296 123 314" fill="none" stroke={FLOW_SOFT} strokeWidth="2" strokeDasharray="4 5" />

    {/* ---- clients to Hypha ---- */}
    <path className="be-flow" d="M287 106C311 106 311 190 335 190" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M287 210H335" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M287 314C311 314 311 230 335 230" fill="none" stroke={FLOW} strokeWidth="2" />

    {/* ---- client column ---- */}
    {CLIENTS.map((client, i) => (
      <g key={client.label}>
        <rect
          x={CLIENT_X}
          y={ROWS[i] - BOX_H / 2}
          width={CLIENT_W}
          height={BOX_H}
          rx="14"
          fill="#ffffff"
          stroke="#e5e7eb"
          strokeWidth="1.5"
        />
        <ClientGlyph index={i} cy={ROWS[i]} tone={client.tone} />
        <text x="179" y={ROWS[i] + 5} fontSize="13" fontWeight="500" fill="#374151">
          {client.label}
        </text>
      </g>
    ))}

    {/* ---- the public Hypha server ---- */}
    <rect
      x={HYPHA_X}
      y={MID_Y - HYPHA_H / 2}
      width={HYPHA_W}
      height={HYPHA_H}
      rx="18"
      fill="#ffffff"
      stroke="#ddd6fe"
      strokeWidth="2"
    />
    <image href={HYPHA_LOGO} x="400" y="170" width="34" height="34" preserveAspectRatio="xMidYMid meet" />
    <text x="444" y="197" fontSize="28" fontWeight="700" fill="#1f2937">
      Hypha
    </text>
    <text x={HYPHA_MID_X} y="230" textAnchor="middle" fontSize="13" fill="#6b7280">
      Central and public server
    </text>
    <text x={HYPHA_MID_X} y="249" textAnchor="middle" fontSize="13" fill="#6b7280">
      Hosted at KTH, Stockholm, Sweden
    </text>

    {/* ---- Hypha to workers ---- */}
    <path className="be-flow" d="M599 190C623 190 623 106 647 106" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M599 210H647" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M599 230C623 230 623 314 647 314" fill="none" stroke={FLOW} strokeWidth="2" />

    {/* ---- worker column ---- */}
    <rect x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H} rx="22" fill="#f8fafc" />
    {WORKERS.map((worker, i) => (
      <g key={worker.name}>
        <rect
          x={WORKER_X}
          y={ROWS[i] - BOX_H / 2}
          width={WORKER_W}
          height={BOX_H}
          rx="14"
          fill="#ffffff"
          stroke="#e5e7eb"
          strokeWidth="1.5"
        />
        <WorkerGlyph index={i} cy={ROWS[i]} />
        <text x="711" y={ROWS[i] - 8} fontSize="14" fontWeight="600" fill="#374151">
          {worker.name}
        </text>
        {worker.chips.map(chip => (
          <Chip key={chip} label={chip} cy={ROWS[i]} />
        ))}
      </g>
    ))}
  </svg>
);

/* -------------------------------------------------------------------------- */
/* Stacked rendering                                                           */
/* -------------------------------------------------------------------------- */

/** 24 by 24 glyphs for the stacked rendering. The wide SVG draws its own at
 *  diagram coordinates, but the shapes match. */
const MiniGlyph: React.FC<{ kind: GlyphKind; className?: string }> = ({ kind, className = '' }) => {
  const shapes: Record<GlyphKind, React.ReactNode> = {
    biologist: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0115 0" />
      </>
    ),
    agent: (
      <>
        <rect x="3" y="8" width="18" height="12" rx="4" />
        <path d="M12 8V4.6" />
        <circle cx="12" cy="3.4" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
    web: (
      <>
        <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
        <path d="M2.5 9.5h19" />
        <circle cx="6" cy="7" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="9" cy="7" r="0.9" fill="currentColor" stroke="none" />
      </>
    ),
    desktop: (
      <>
        <rect x="2.5" y="4" width="19" height="13" rx="2" />
        <path d="M9 17v3M15 17v3M7 20h10" />
      </>
    ),
    laptop: (
      <>
        <rect x="4" y="4.5" width="16" height="11" rx="2" />
        <path d="M2 19h20" />
      </>
    ),
    workstation: (
      <>
        <rect x="3.5" y="3.5" width="17" height="12" rx="2" />
        <path d="M9.5 15.5v4M14.5 15.5v4M7 19.5h10" />
      </>
    ),
    cluster: (
      <>
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <rect x="3" y="14" width="18" height="7" rx="2" />
        <circle cx="7" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="7" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
        <path d="M11 7.5h7M11 17.5h7" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-5 h-5 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[kind]}
    </svg>
  );
};

const STACK_CLIENTS: { kind: GlyphKind; label: string; tone: string }[] = [
  { kind: 'biologist', label: 'Biologist', tone: 'text-slate-400' },
  { kind: 'agent', label: 'AI agents', tone: 'text-blue-600' },
  { kind: 'web', label: 'Web clients', tone: 'text-purple-600' },
  { kind: 'desktop', label: 'Desktop clients', tone: 'text-cyan-600' },
];

const STACK_WORKERS: { kind: GlyphKind; name: string; chips: string[] }[] = [
  { kind: 'laptop', name: 'Laptop', chips: ['Ray'] },
  { kind: 'workstation', name: 'Workstation', chips: ['Ray'] },
  { kind: 'cluster', name: 'Institutional cluster', chips: ['Ray', 'Kubernetes', 'SLURM'] },
];

const StackLink: React.FC = () => (
  <svg className="mx-auto my-2.5" width="2" height="30" aria-hidden="true" focusable="false">
    <line className="be-flow-v" x1="1" y1="0" x2="1" y2="30" stroke={FLOW} strokeWidth="2" />
  </svg>
);

const StackChip: React.FC<{ label: string }> = ({ label }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
      label === 'Ray'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-slate-100 text-slate-600'
    }`}
  >
    {label}
  </span>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-2 text-center text-xs font-semibold text-gray-700">{children}</p>
);

const ArchitectureStack: React.FC = () => (
  <div>
    <SectionLabel>Clients and agents</SectionLabel>
    <div className="grid grid-cols-2 gap-2">
      {STACK_CLIENTS.map(client => (
        <div
          key={client.label}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-2.5 py-2"
        >
          <MiniGlyph kind={client.kind} className={client.tone} />
          <span className="text-xs font-medium text-gray-700">{client.label}</span>
        </div>
      ))}
    </div>

    <StackLink />

    <div className="rounded-2xl border-2 border-violet-200 bg-white px-4 py-4 text-center">
      <div className="mb-1.5 flex items-center justify-center gap-2">
        <img src={HYPHA_LOGO} alt="" aria-hidden="true" className="w-7 h-7" />
        <span className="text-xl font-bold text-gray-800">Hypha</span>
      </div>
      <p className="text-xs text-gray-600">Central and public server</p>
      <p className="text-xs text-gray-600">Hosted at KTH, Stockholm, Sweden</p>
    </div>

    <StackLink />

    <SectionLabel>Distributed workers</SectionLabel>
    <div className="space-y-2 rounded-2xl bg-slate-50 p-2.5">
      {STACK_WORKERS.map(worker => (
        <div
          key={worker.name}
          className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5"
        >
          <MiniGlyph kind={worker.kind} className="text-gray-500" />
          <div>
            <p className="text-xs font-semibold text-gray-700">{worker.name}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {worker.chips.map(chip => (
                <StackChip key={chip} label={chip} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/* -------------------------------------------------------------------------- */

const BioEngineArchitectureDiagram: React.FC = () => (
  <div className="be-arch">
    <div className="hidden md:block">
      <ArchitectureSvg />
    </div>
    <div className="md:hidden">
      <ArchitectureStack />
    </div>
  </div>
);

export default BioEngineArchitectureDiagram;
