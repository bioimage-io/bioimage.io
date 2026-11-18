import React from 'react';
import './bioengine-landing.css';

/**
 * The "How BioEngine works" diagram on `/bioengine`.
 *
 * The story the picture tells: clients and agents connect to BioEngine, and
 * BioEngine runs the work on whichever worker fits. So BioEngine is drawn as one
 * labelled container holding both its communication hub and its workers, and the
 * client connectors cross into that container to reach the hub.
 *
 * Hypha and Ray are peers here, two technologies BioEngine is built on, and both
 * appear the same way: as a small accent chip on the node that uses them. Neither
 * gets logo artwork or a headline. Everything is drawn in the site's own visual
 * language (thin strokes, rounded rectangles, gray labels) rather than imported
 * as an image, so it scales, picks up the page font, and stays editable. The one
 * image is the BioEngine giraffe itself, which is the product label.
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

const BIOENGINE_ICON = '/static/img/bioengine-icon.svg';

const DIAGRAM_SUMMARY =
  'A biologist works through AI agents, web clients and desktop clients. All of them connect to BioEngine, whose communication hub, built on Hypha, routes every call to one of its distributed workers: a laptop, a workstation or an institutional cluster. Every worker runs Ray, and the cluster adds Kubernetes or SLURM.';

/*
 * Geometry. Every box in the wide rendering derives from these, so the client
 * column keeps an equal 28 unit vertical gap, the BioEngine box keeps an equal
 * 16 unit padding around what it contains, and the biologist, the middle client,
 * the hub and the middle worker all sit on one midline. Change a constant, not a
 * coordinate.
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
const CLIENT_RIGHT = CLIENT_X + CLIENT_W;

/** The BioEngine container, and the two things it holds. */
const GROUP_PAD = 16;
/** Height of the label band above the contents, enough for the 26 unit giraffe. */
const GROUP_LABEL_H = 50;
const GROUP_X = 331;
const GROUP_Y = ROWS[0] - BOX_H / 2 - GROUP_LABEL_H;
const GROUP_LABEL_CY = GROUP_Y + GROUP_LABEL_H / 2 - 2;

const HUB_X = GROUP_X + GROUP_PAD;
const HUB_W = 196;
const HUB_H = 108;
const HUB_Y = MID_Y - HUB_H / 2;
const HUB_RIGHT = HUB_X + HUB_W;
const HUB_MID_X = HUB_X + HUB_W / 2;

const WORKER_X = 643;
const WORKER_W = 280;
const WORKER_MID_X = WORKER_X + WORKER_W / 2;

const GROUP_W = WORKER_X + WORKER_W + GROUP_PAD - GROUP_X;
const GROUP_H = ROWS[2] + BOX_H / 2 + GROUP_PAD - GROUP_Y;

/** Midpoints of the two connector spans, used as the cubic control abscissa. */
const CLIENT_BEND = (CLIENT_RIGHT + HUB_X) / 2;
const WORKER_BEND = (HUB_RIGHT + WORKER_X) / 2;
/** Where the three client lines enter the hub, and leave it for the workers. */
const HUB_PORTS = [MID_Y - 24, MID_Y, MID_Y + 24];

const VIEW_BOX = '0 10 960 370';

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

/** The one warm accent in a blue, purple and cyan page: the giraffe's orange,
 *  taken down to a tint that a white card can still sit on. */
const BE_FILL = '#fff7ed';
const BE_BORDER = '#fed7aa';
const BE_TEXT = '#c2410c';

type GlyphKind =
  | 'biologist'
  | 'agent'
  | 'web'
  | 'desktop'
  | 'hub'
  | 'laptop'
  | 'workstation'
  | 'cluster';

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
  const x = WORKER_X + 18;
  const stroke = {
    fill: 'none',
    stroke: '#6b7280',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (index === 0) {
    return (
      <g transform={`translate(${x} ${cy - 12})`} {...stroke}>
        <rect x="2" y="0" width="28" height="19" rx="2.5" />
        <path d="M0 24h32" />
      </g>
    );
  }

  if (index === 1) {
    return (
      <g transform={`translate(${x} ${cy - 14})`} {...stroke}>
        <rect x="1" y="0" width="30" height="21" rx="2.5" />
        <path d="M12 21v6M20 21v6M8 27h16" />
      </g>
    );
  }

  return (
    <g transform={`translate(${x} ${cy - 17})`} {...stroke}>
      <rect x="1" y="0" width="30" height="14" rx="3" />
      <rect x="1" y="20" width="30" height="14" rx="3" />
      <circle cx="8" cy="7" r="1.6" fill="#6b7280" stroke="none" />
      <circle cx="8" cy="27" r="1.6" fill="#6b7280" stroke="none" />
      <path d="M14 7h12M14 27h12" />
    </g>
  );
};

/** One chassis with three bays. Deliberately a single box, where the cluster
 *  glyph is two detached ones, so the two never read as the same machine. */
const HubGlyph: React.FC = () => (
  <g
    transform={`translate(${HUB_MID_X - 13} ${HUB_Y + 11})`}
    fill="none"
    stroke="#6b7280"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="0" y="0" width="26" height="34" rx="3" />
    <path d="M0 11.5h26M0 23h26" />
    <circle cx="5.5" cy="5.8" r="1.5" fill="#6b7280" stroke="none" />
    <circle cx="5.5" cy="17.3" r="1.5" fill="#6b7280" stroke="none" />
    <circle cx="5.5" cy="28.8" r="1.5" fill="#6b7280" stroke="none" />
    <path d="M10.5 5.8h11M10.5 17.3h11M10.5 28.8h11" />
  </g>
);

/** Rounded pill for a technology wordmark. Hypha and Ray are what the hub and
 *  the workers are built on, so both carry the accent, while Kubernetes and
 *  SLURM, which only describe how a cluster is managed, stay neutral. */
const Chip: React.FC<{ label: string; x: number; y: number; w: number }> = ({ label, x, y, w }) => {
  const accent = label === 'Ray' || label === 'Hypha';
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height="22"
        rx="11"
        fill={accent ? '#eff6ff' : '#f1f5f9'}
        stroke={accent ? '#bfdbfe' : '#e2e8f0'}
        strokeWidth="1.2"
      />
      <text
        x={x + w / 2}
        y={y + 15}
        textAnchor="middle"
        fontSize="12"
        fontWeight="600"
        fill={accent ? '#1d4ed8' : '#475569'}
      >
        {label}
      </text>
    </g>
  );
};

/** Worker chip positions, as an offset from the worker card's own left edge. */
const WORKER_CHIPS: Record<string, { dx: number; w: number }> = {
  Ray: { dx: 64, w: 48 },
  Kubernetes: { dx: 119, w: 82 },
  SLURM: { dx: 208, w: 60 },
};

const ArchitectureSvg: React.FC = () => (
  <svg viewBox={VIEW_BOX} className="w-full h-auto" role="img" aria-label={DIAGRAM_SUMMARY}>
    <defs>
      {/* Lifts the hub off the group fill so it reads as the way in, with the
          workers sitting flat behind it. */}
      <filter id="be-hub-lift" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#9a3412" floodOpacity="0.16" />
      </filter>
    </defs>

    {/* ---- the BioEngine container ---- */}
    <rect
      x={GROUP_X}
      y={GROUP_Y}
      width={GROUP_W}
      height={GROUP_H}
      rx="22"
      fill={BE_FILL}
      stroke={BE_BORDER}
      strokeWidth="2"
    />
    <image
      href={BIOENGINE_ICON}
      x={GROUP_X + 18}
      y={GROUP_LABEL_CY - 13}
      width="26"
      height="26"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    />
    <text
      x={GROUP_X + 52}
      y={GROUP_LABEL_CY + 7}
      fontSize="20"
      fontWeight="700"
      letterSpacing="-0.2"
      fill={BE_TEXT}
    >
      BioEngine
    </text>
    {/* Neutral, like the heading on the other side. The warm accent belongs to
        the container and its product label, and to nothing else. */}
    <text
      x={WORKER_MID_X}
      y={GROUP_LABEL_CY + 5}
      textAnchor="middle"
      fontSize="13"
      fontWeight="600"
      fill="#4b5563"
    >
      Workers
    </text>

    {/* ---- column heading for the left side ---- */}
    <text
      x={CLIENT_X + CLIENT_W / 2}
      y={GROUP_LABEL_CY + 5}
      textAnchor="middle"
      fontSize="14"
      fontWeight="600"
      fill="#374151"
    >
      Clients and agents
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

    {/* ---- clients into BioEngine, landing on the hub ---- */}
    {ROWS.map((row, i) => (
      <path
        key={`in-${row}`}
        className="be-flow"
        d={
          row === MID_Y
            ? `M${CLIENT_RIGHT} ${MID_Y}H${HUB_X}`
            : `M${CLIENT_RIGHT} ${row}C${CLIENT_BEND} ${row} ${CLIENT_BEND} ${HUB_PORTS[i]} ${HUB_X} ${HUB_PORTS[i]}`
        }
        fill="none"
        stroke={FLOW}
        strokeWidth="2"
      />
    ))}

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

    {/* ---- hub out to the workers ---- */}
    {ROWS.map((row, i) => (
      <path
        key={`out-${row}`}
        className="be-flow"
        d={
          row === MID_Y
            ? `M${HUB_RIGHT} ${MID_Y}H${WORKER_X}`
            : `M${HUB_RIGHT} ${HUB_PORTS[i]}C${WORKER_BEND} ${HUB_PORTS[i]} ${WORKER_BEND} ${row} ${WORKER_X} ${row}`
        }
        fill="none"
        stroke={FLOW}
        strokeWidth="2"
      />
    ))}

    {/* ---- worker column ---- */}
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
        <text x={WORKER_X + 64} y={ROWS[i] - 8} fontSize="14" fontWeight="600" fill="#374151">
          {worker.name}
        </text>
        {worker.chips.map(chip => (
          <Chip
            key={chip}
            label={chip}
            x={WORKER_X + WORKER_CHIPS[chip].dx}
            y={ROWS[i]}
            w={WORKER_CHIPS[chip].w}
          />
        ))}
      </g>
    ))}

    {/* ---- the communication hub, drawn last so it sits over the connectors ---- */}
    <g filter="url(#be-hub-lift)">
      <rect
        x={HUB_X}
        y={HUB_Y}
        width={HUB_W}
        height={HUB_H}
        rx="16"
        fill="#ffffff"
        stroke="#e5e7eb"
        strokeWidth="1.5"
      />
    </g>
    <HubGlyph />
    <text
      x={HUB_MID_X}
      y={HUB_Y + 66}
      textAnchor="middle"
      fontSize="13"
      fontWeight="600"
      fill="#374151"
    >
      Communication hub
    </text>
    <Chip label="Hypha" x={HUB_MID_X - 29} y={HUB_Y + 76} w={58} />
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
    hub: (
      <>
        <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
        <path d="M5 9h14M5 15h14" />
        <circle cx="8" cy="5.8" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="8" cy="12" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="8" cy="18.2" r="0.9" fill="currentColor" stroke="none" />
        <path d="M11 5.8h5M11 12h5M11 18.2h5" />
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

const StackLink: React.FC<{ height?: number }> = ({ height = 30 }) => (
  <svg className="mx-auto my-2.5" width="2" height={height} aria-hidden="true" focusable="false">
    <line className="be-flow-v" x1="1" y1="0" x2="1" y2={height} stroke={FLOW} strokeWidth="2" />
  </svg>
);

const StackChip: React.FC<{ label: string }> = ({ label }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
      label === 'Ray' || label === 'Hypha'
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

    {/* Same story as the wide rendering: one BioEngine container holding the hub
        and the workers it routes to. */}
    <div className="rounded-2xl border-2 border-orange-200 bg-orange-50/70 p-3">
      <div className="mb-3 flex items-center gap-2">
        <img src={BIOENGINE_ICON} alt="" aria-hidden="true" className="w-6 h-6" />
        <span className="text-base font-bold tracking-tight text-orange-700">BioEngine</span>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow">
        <MiniGlyph kind="hub" className="text-gray-500" />
        <div>
          <p className="text-xs font-semibold text-gray-700">Communication hub</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StackChip label="Hypha" />
          </div>
        </div>
      </div>

      <StackLink height={22} />

      <p className="mb-2 text-center text-xs font-semibold text-gray-600">Workers</p>
      <div className="space-y-2">
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
