import React from 'react';
import './bioengine-landing.css';

/**
 * The "How BioEngine works" diagram on `/bioengine`.
 *
 * Three columns: the people and clients on the left, the public Hypha server in
 * the middle, the distributed workers on the right. Everything is drawn here in
 * the site's own visual language (thin strokes, rounded rectangles, the blue to
 * purple to cyan accents, gray labels) rather than imported as an image, so it
 * scales, picks up the page font, and stays editable.
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

const VIEW_W = 960;
const VIEW_H = 420;

const DIAGRAM_SUMMARY =
  'A biologist works through AI agents, web clients and desktop clients, which all connect to one public Hypha server hosted at KTH in Stockholm, Sweden. Hypha routes the work to distributed BioEngine workers, each running Ray, on a laptop, a workstation or an institutional cluster managed with Kubernetes or SLURM.';

/** Browsers, desktop tools and agents, all on the same footing. */
const CLIENTS = [
  { y: 66, label: 'AI agents' },
  { y: 184, label: 'Web clients' },
  { y: 302, label: 'Desktop clients' },
];

/** Connector colours. Light enough to sit behind the nodes, dark enough that the
 *  flow animation is actually visible against white. */
const FLOW = '#94a3b8';
const FLOW_SOFT = '#cbd5e1';

/* -------------------------------------------------------------------------- */
/* Shared marks                                                                */
/* -------------------------------------------------------------------------- */

/** A ring of dots standing in for the Hypha mark, drawn rather than copied.
 *  Shared by both renderings so the two never drift apart. */
const HyphaDots: React.FC<{ cx: number; cy: number; radius: number }> = ({ cx, cy, radius }) => (
  <>
    {Array.from({ length: 9 }).map((_, i) => {
      const angle = (i / 9) * Math.PI * 2 - Math.PI / 2;
      const ring = radius - i * radius * 0.042;
      return (
        <circle
          key={`hypha-dot-${i}`}
          cx={cx + Math.cos(angle) * ring}
          cy={cy + Math.sin(angle) * ring}
          r={radius * 0.26 - i * radius * 0.014}
          fill="#6d28d9"
          opacity={1 - i * 0.07}
        />
      );
    })}
  </>
);

type GlyphKind = 'biologist' | 'agent' | 'web' | 'desktop' | 'laptop' | 'workstation' | 'cluster';

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

/* -------------------------------------------------------------------------- */
/* Wide rendering                                                              */
/* -------------------------------------------------------------------------- */

const ClientGlyph: React.FC<{ index: number; y: number }> = ({ index, y }) => {
  const common = {
    fill: 'none',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (index === 0) {
    return (
      <g transform={`translate(100 ${y + 14})`} stroke="#2563eb" {...common}>
        <rect x="1" y="6" width="22" height="16" rx="5" />
        <path d="M12 6V2" />
        <circle cx="12" cy="1.4" r="1.6" fill="#2563eb" stroke="none" />
        <circle cx="8" cy="14" r="1.9" fill="#2563eb" stroke="none" />
        <circle cx="16" cy="14" r="1.9" fill="#2563eb" stroke="none" />
      </g>
    );
  }

  if (index === 1) {
    return (
      <g transform={`translate(100 ${y + 14})`} stroke="#7c3aed" {...common}>
        <rect x="1" y="3" width="22" height="18" rx="3" />
        <path d="M1 9.5h22" />
        <circle cx="5" cy="6.2" r="1.1" fill="#7c3aed" stroke="none" />
        <circle cx="9" cy="6.2" r="1.1" fill="#7c3aed" stroke="none" />
      </g>
    );
  }

  return (
    <g transform={`translate(100 ${y + 14})`} stroke="#0891b2" {...common}>
      <rect x="1" y="3" width="22" height="15" rx="2.5" />
      <path d="M9 18v3M15 18v3M7 21h10" />
    </g>
  );
};

/** Rounded pill used for the Ray, Kubernetes and SLURM wordmarks. */
const Chip: React.FC<{
  x: number;
  y: number;
  w: number;
  label: string;
  fill: string;
  stroke: string;
  color: string;
}> = ({ x, y, w, label, fill, stroke, color }) => (
  <g>
    <rect x={x} y={y} width={w} height="22" rx="11" fill={fill} stroke={stroke} strokeWidth="1.2" />
    <text x={x + w / 2} y={y + 15} textAnchor="middle" fontSize="12" fontWeight="600" fill={color}>
      {label}
    </text>
  </g>
);

const ArchitectureSvg: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto" role="img" aria-label={DIAGRAM_SUMMARY}>
    {/* ---- left column: people and clients ---- */}
    <text x="164" y="38" textAnchor="middle" fontSize="14" fontWeight="600" fill="#374151">
      Clients and agents
    </text>

    {/* The biologist gets the same card treatment as the clients, as an avatar,
        so the left edge of the diagram does not trail off into whitespace. */}
    <circle cx="42" cy="206" r="26" fill="#ffffff" stroke="#e5e7eb" strokeWidth="1.5" />
    <circle cx="42" cy="199" r="7.5" fill="#94a3b8" />
    <path d="M29.5 220a12.5 12.5 0 0125 0z" fill="#94a3b8" />
    <text x="42" y="250" textAnchor="middle" fontSize="13" fill="#6b7280">
      Biologist
    </text>

    <path d="M68 194C82 162 76 110 88 94" fill="none" stroke={FLOW_SOFT} strokeWidth="2" strokeDasharray="4 5" />
    <path d="M70 207L88 209" fill="none" stroke={FLOW_SOFT} strokeWidth="2" strokeDasharray="4 5" />
    <path d="M68 218C82 250 76 312 88 326" fill="none" stroke={FLOW_SOFT} strokeWidth="2" strokeDasharray="4 5" />

    {CLIENTS.map((client, i) => (
      <g key={client.label}>
        <rect x="88" y={client.y} width="152" height="52" rx="12" fill="#ffffff" stroke="#e5e7eb" strokeWidth="1.5" />
        <ClientGlyph index={i} y={client.y} />
        <text x="134" y={client.y + 31} fontSize="13" fontWeight="500" fill="#374151">
          {client.label}
        </text>
      </g>
    ))}

    {/* ---- clients to Hypha ---- */}
    <path className="be-flow" d="M240 92C292 92 292 190 344 190" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M240 210H344" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M240 328C292 328 292 230 344 230" fill="none" stroke={FLOW} strokeWidth="2" />

    {/* ---- centre: the public Hypha server ---- */}
    <rect x="344" y="148" width="272" height="124" rx="18" fill="#ffffff" stroke="#ddd6fe" strokeWidth="2" />
    <HyphaDots cx={384} cy={196} radius={13} />

    <text x="412" y="206" fontSize="28" fontWeight="700" fill="#1f2937">
      Hypha
    </text>
    <text x="364" y="238" fontSize="13" fill="#6b7280">
      Central and public server
    </text>
    <text x="364" y="257" fontSize="13" fill="#6b7280">
      Hosted at KTH, Stockholm, Sweden
    </text>
    <text x="480" y="298" textAnchor="middle" fontSize="12" fill="#9ca3af">
      The public bioimage-io worker runs at KTH too
    </text>

    {/* ---- Hypha to workers ---- */}
    <path className="be-flow" d="M616 192C652 192 648 110 684 110" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M616 210C652 210 648 218 684 218" fill="none" stroke={FLOW} strokeWidth="2" />
    <path className="be-flow" d="M616 228C652 228 648 340 684 340" fill="none" stroke={FLOW} strokeWidth="2" />

    {/* ---- right column: distributed workers ---- */}
    <rect x="664" y="52" width="280" height="348" rx="22" fill="#f8fafc" />
    <text x="804" y="38" textAnchor="middle" fontSize="14" fontWeight="600" fill="#374151">
      Distributed workers
    </text>

    {/* Laptop */}
    <rect x="684" y="68" width="240" height="84" rx="14" fill="#ffffff" stroke="#e5e7eb" strokeWidth="1.5" />
    <g transform="translate(700 96)" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinejoin="round">
      <rect x="2" y="0" width="28" height="19" rx="2.5" />
      <path d="M0 24h32" strokeLinecap="round" />
    </g>
    <text x="748" y="102" fontSize="14" fontWeight="600" fill="#374151">
      Laptop
    </text>
    <Chip x={748} y={112} w={52} label="Ray" fill="#eff6ff" stroke="#bfdbfe" color="#1d4ed8" />

    {/* Workstation */}
    <rect x="684" y="176" width="240" height="84" rx="14" fill="#ffffff" stroke="#e5e7eb" strokeWidth="1.5" />
    <g transform="translate(700 202)" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0" y="0" width="30" height="21" rx="2.5" />
      <path d="M11 21v6M19 21v6M7 27h16" />
    </g>
    <text x="748" y="210" fontSize="14" fontWeight="600" fill="#374151">
      Workstation
    </text>
    <Chip x={748} y={220} w={52} label="Ray" fill="#eff6ff" stroke="#bfdbfe" color="#1d4ed8" />

    {/* Institutional cluster */}
    <rect x="684" y="284" width="240" height="112" rx="14" fill="#ffffff" stroke="#e5e7eb" strokeWidth="1.5" />
    <g transform="translate(700 306)" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round">
      <rect x="0" y="0" width="30" height="14" rx="3" />
      <rect x="0" y="20" width="30" height="14" rx="3" />
      <circle cx="7" cy="7" r="1.6" fill="#6b7280" stroke="none" />
      <circle cx="7" cy="27" r="1.6" fill="#6b7280" stroke="none" />
      <path d="M13 7h12M13 27h12" />
    </g>
    <text x="748" y="314" fontSize="14" fontWeight="600" fill="#374151">
      Institutional cluster
    </text>
    <Chip x={748} y={324} w={52} label="Ray" fill="#eff6ff" stroke="#bfdbfe" color="#1d4ed8" />
    <Chip x={748} y={356} w={84} label="Kubernetes" fill="#f1f5f9" stroke="#e2e8f0" color="#475569" />
    <Chip x={840} y={356} w={62} label="SLURM" fill="#f1f5f9" stroke="#e2e8f0" color="#475569" />
  </svg>
);

/* -------------------------------------------------------------------------- */
/* Stacked rendering                                                           */
/* -------------------------------------------------------------------------- */

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
        <svg viewBox="0 0 32 32" className="w-7 h-7" aria-hidden="true" focusable="false">
          <HyphaDots cx={16} cy={16} radius={11} />
        </svg>
        <span className="text-xl font-bold text-gray-800">Hypha</span>
      </div>
      <p className="text-xs text-gray-600">Central and public server</p>
      <p className="text-xs text-gray-600">Hosted at KTH, Stockholm, Sweden</p>
    </div>
    <p className="mt-2 text-center text-[11px] text-gray-400">
      The public bioimage-io worker runs at KTH too
    </p>

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
