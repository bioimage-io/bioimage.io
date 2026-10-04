// Import a remote OME-Zarr source into a dataset (colab-c-ometiff-design.md
// §7, step 4, and §13 step 6 for regions). Nothing is copied: the broker reads
// the store's metadata, fetches a single chunk to prove the browser will be
// able to read it too, and records a `remote` manifest entry. That check is
// the whole point of doing this server-side, so its rejection messages are
// written to be read by the person pasting the URL and are surfaced here
// verbatim.
//
// Two steps, because a whole-slide source cannot be offered for selection
// until its extent is known. Step one checks the URL; step two shows what is
// there and lets a patch be taken out of it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ImportNgffResult,
  NgffProbe,
  PixelRegion,
  importNgffImage,
  probeNgffSource,
} from './brokerApi';
import { materialiseBytes } from './ngffLayout';
import { openImageSource } from './imageSource';
import type { ImageSourceHandle } from './imageSource';

interface ImportRemoteSourceModalProps {
  server: any;
  artifactId: string;
  onClose: () => void;
  onImported: (result: ImportNgffResult) => void;
}

/**
 * Long axis the preview is rendered at. `displayUrl` picks the cheapest
 * pyramid level that still covers it, so a slide costs one coarse level here
 * rather than its base.
 */
const PREVIEW_LONG_AXIS = 640;

/**
 * Decoded pixels the preview is allowed to cost. A store whose coarsest level
 * is still enormous exists (a two-level pyramid over a slide), and decoding it
 * to draw a thumbnail would hang the tab. Past this the picker falls back to
 * the numeric fields, which need no pixels at all.
 */
const MAX_PREVIEW_PIXELS = 8_000_000;

/**
 * A Hypha RPC error carries the remote exception's text, which for a rejected
 * import is exactly the sentence we want to show. Some errors arrive with a
 * Python traceback in front of it; the last non-empty line is the message in
 * that case, and is the whole string otherwise.
 */
function readableError(err: unknown): string {
  const raw = String((err as Error)?.message ?? err ?? '').trim();
  if (!raw) return 'The import failed.';
  if (!raw.includes('Traceback (most recent call last)')) return raw;
  const lines = raw.split('\n').filter((line) => line.trim());
  const last = lines[lines.length - 1] ?? raw;
  // Strip the `ValueError: ` style prefix the traceback's final line carries.
  return last.replace(/^[A-Za-z_][A-Za-z0-9_.]*(Error|Exception):\s*/, '');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What the annotator will actually draw for a store with this many channels.
 *
 * The decode seam hands at most three bands to `rastersToRgba`, which maps one
 * band to grey, three to RGB, and anything in between to the first band alone.
 * None of that is visible in the result, so it is said here, while the source
 * is still being chosen and a different multiscale or region is still free.
 * Returns null for the two cases that need no explanation.
 */
export function channelDisplayNote(count: number): string | null {
  if (count === 2) {
    return 'This source has two channels. The annotator draws the first one in grey and does not show the second.';
  }
  if (count > 3) {
    return `This source has ${count} channels. The annotator draws the first three as red, green and blue and does not show the other ${count - 3}.`;
  }
  return null;
}

/** A rectangle in the preview element's own coordinates. */
interface DraftRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ImportRemoteSourceModal: React.FC<ImportRemoteSourceModalProps> = ({
  server,
  artifactId,
  onClose,
  onImported,
}) => {
  const [storeRoot, setStoreRoot] = useState('');
  const [name, setName] = useState('');
  const [multiscale, setMultiscale] = useState('');
  const [probe, setProbe] = useState<NgffProbe | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [region, setRegion] = useState<PixelRegion | null>(null);
  const [draft, setDraft] = useState<DraftRect | null>(null);

  const urlRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const busy = checking || importing;

  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  /**
   * Render a thumbnail of the source once it is known to be readable.
   *
   * Read straight from the store by the browser, using the URL as typed: a
   * path-form credential has to stay on it, because the probe deliberately
   * hands back the untokened root (it is what gets written to the manifest)
   * and that form fetches nothing.
   *
   * A failure here is not an import failure. The source is already proven
   * readable by the broker's preflight, so the picker falls back to the
   * numeric fields and says so rather than blocking.
   */
  useEffect(() => {
    if (!probe) return;
    let cancelled = false;
    // A box rather than a plain binding: the handle is only assigned partway
    // through the async body, and the cleanup has to be able to close one
    // that arrived after it ran.
    const open: { handle: ImageSourceHandle | null } = { handle: null };

    (async () => {
      try {
        const handle = await openImageSource({
          kind: 'ngff',
          storeRoot: storeRoot.trim(),
          multiscalePath: multiscale.trim() || undefined,
        });
        open.handle = handle;
        if (cancelled) {
          handle.close();
          return;
        }
        const level = handle.levels[handle.levelForLongAxis(PREVIEW_LONG_AXIS)];
        if (level.width * level.height > MAX_PREVIEW_PIXELS) {
          throw new Error('This source has no level small enough to preview quickly.');
        }
        const url = await handle.displayUrl(PREVIEW_LONG_AXIS);
        if (!cancelled) setPreviewUrl(url);
      } catch (err) {
        if (!cancelled) setPreviewNote(readableError(err));
      }
    })();

    return () => {
      cancelled = true;
      // Revokes the object URL the preview is rendered from, so this runs
      // only when the dialog closes or the source changes.
      open.handle?.close();
    };
  }, [probe, storeRoot, multiscale]);

  /** Clamp a region into the store and refuse an empty one. */
  const commitRegion = useCallback(
    (next: PixelRegion | null) => {
      if (!next || !probe) {
        setRegion(null);
        return;
      }
      const x = Math.min(Math.max(0, Math.round(next.x)), Math.max(0, probe.width - 1));
      const y = Math.min(Math.max(0, Math.round(next.y)), Math.max(0, probe.height - 1));
      const width = Math.min(Math.max(1, Math.round(next.width)), probe.width - x);
      const height = Math.min(Math.max(1, Math.round(next.height)), probe.height - y);
      setRegion({ x, y, width, height });
    },
    [probe],
  );

  const pointInPreview = (e: React.PointerEvent): { x: number; y: number } | null => {
    const box = previewRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return {
      x: Math.min(Math.max(0, e.clientX - box.left), box.width),
      y: Math.min(Math.max(0, e.clientY - box.top), box.height),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    const p = pointInPreview(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = pointInPreview(e);
    if (p) setDraft({ ...draft, x1: p.x, y1: p.y });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!draft || !probe) return;
    const box = previewRef.current?.getBoundingClientRect();
    setDraft(null);
    if (!box || box.width <= 0 || box.height <= 0) return;
    const left = Math.min(draft.x0, draft.x1);
    const top = Math.min(draft.y0, draft.y1);
    const width = Math.abs(draft.x1 - draft.x0);
    const height = Math.abs(draft.y1 - draft.y0);
    // A click with no drag means "start over", not a one-pixel patch.
    if (width < 4 || height < 4) {
      commitRegion(null);
      return;
    }
    const sx = probe.width / box.width;
    const sy = probe.height / box.height;
    commitRegion({ x: left * sx, y: top * sy, width: width * sx, height: height * sy });
  };

  /** The committed region, in the preview element's coordinates. */
  const regionOnPreview = (): React.CSSProperties | null => {
    if (!region || !probe || !probe.width || !probe.height) return null;
    return {
      left: `${(region.x / probe.width) * 100}%`,
      top: `${(region.y / probe.height) * 100}%`,
      width: `${(region.width / probe.width) * 100}%`,
      height: `${(region.height / probe.height) * 100}%`,
    };
  };

  const handleCheck = async () => {
    const root = storeRoot.trim();
    if (!root || busy) return;
    setChecking(true);
    setError(null);
    try {
      const found = await probeNgffSource(server, root, multiscale.trim() || undefined);
      setProbe(found);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setChecking(false);
    }
  };

  const handleBack = () => {
    setProbe(null);
    setPreviewUrl(null);
    setPreviewNote(null);
    setRegion(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!probe) {
      await handleCheck();
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const result = await importNgffImage(
        server,
        artifactId,
        storeRoot.trim(),
        name.trim() || undefined,
        multiscale.trim() || undefined,
        region,
      );
      onImported(result);
      onClose();
    } catch (err) {
      setError(readableError(err));
      setImporting(false);
    }
  };

  const width = region ? region.width : probe?.width ?? 0;
  const height = region ? region.height : probe?.height ?? 0;
  const bytes = probe ? materialiseBytes(width, height, probe.dtype, probe.channels) : 0;
  const tooLargeToCopy = !!probe && bytes > 0 && bytes > probe.max_materialise_bytes;
  const channelNote = probe ? channelDisplayNote(probe.channels.length) : null;

  /**
   * Edit one field of the region, taking the whole image as the starting
   * point when none has been drawn yet. Typing a width is then how a region
   * gets made, which is the only route available when the preview failed.
   */
  const patchRegion = (change: Partial<PixelRegion>) =>
    commitRegion({ x: 0, y: 0, width, height, ...region, ...change });

  const numberField = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ) => (
    <label className="flex-1 min-w-0">
      <span className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label="Import a remote OME-Zarr source"
        className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-lg w-full mx-4 border border-white/20 animate-scaleIn max-h-[92vh] flex flex-col"
      >
        <div className="p-6 border-b border-gray-200/50 flex items-center">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Link a remote OME-Zarr image</h3>
            <p className="text-xs text-gray-500">The pixels stay where they are. Nothing is copied into this dataset.</p>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {!probe && (
            <>
              <div>
                <label htmlFor="ngff-store-root" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Store URL
                </label>
                <input
                  id="ngff-store-root"
                  ref={urlRef}
                  type="url"
                  value={storeRoot}
                  onChange={(e) => setStoreRoot(e.target.value)}
                  disabled={busy}
                  placeholder="https://example.org/data/my-sample.zarr/"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  The group that holds the multiscales metadata, not one of its arrays. For a source that needs a token,
                  use the path form (https://host/t/TOKEN/zarr/id/) rather than a query string. The token is kept by the
                  broker and never written into the dataset.
                </p>
              </div>

              <details className="group">
                <summary className="text-sm text-gray-500 cursor-pointer select-none hover:text-gray-700 transition-colors">
                  More options
                </summary>
                <div className="mt-3">
                  <label htmlFor="ngff-multiscale" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Multiscale name
                  </label>
                  <input
                    id="ngff-multiscale"
                    type="text"
                    value={multiscale}
                    onChange={(e) => setMultiscale(e.target.value)}
                    disabled={busy}
                    placeholder="Only needed when the store holds several"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
                  />
                </div>
              </details>
            </>
          )}

          {probe && (
            <>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 font-medium tabular-nums">
                    {probe.width} x {probe.height} pixels, {probe.levels}{' '}
                    {probe.levels === 1 ? 'level' : 'levels'}, {probe.dtype}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {probe.channels.length > 0
                      ? probe.channels.join(', ')
                      : 'No channel names in the store'}
                  </p>
                  {/* The untokened root, so a credential in the pasted URL is
                      not put back on screen. */}
                  <p className="text-[11px] text-gray-400 font-mono truncate mt-1" title={probe.store_root}>
                    {probe.store_root}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-medium text-gray-700">Region to import</span>
                  {region && (
                    <button
                      type="button"
                      onClick={() => commitRegion(null)}
                      disabled={busy}
                      className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
                    >
                      Use the whole image
                    </button>
                  )}
                </div>

                {previewUrl ? (
                  <div
                    ref={previewRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className="relative select-none touch-none cursor-crosshair rounded-xl overflow-hidden border border-gray-200 bg-gray-900"
                  >
                    <img
                      src={previewUrl}
                      alt="Preview of the remote source"
                      draggable={false}
                      className="w-full block pointer-events-none"
                    />
                    {draft && (
                      <div
                        className="absolute border-2 border-indigo-400 bg-indigo-400/20 pointer-events-none"
                        style={{
                          left: Math.min(draft.x0, draft.x1),
                          top: Math.min(draft.y0, draft.y1),
                          width: Math.abs(draft.x1 - draft.x0),
                          height: Math.abs(draft.y1 - draft.y0),
                        }}
                      />
                    )}
                    {!draft && region && (
                      // The spread shadow dims everything outside the patch
                      // and is clipped by the container, so the region stays
                      // visible through a hole with no second copy of the
                      // image and nothing measured during render.
                      <div
                        className="absolute border-2 border-indigo-400 pointer-events-none shadow-[0_0_0_9999px_rgba(17,24,39,0.55)]"
                        style={regionOnPreview() ?? undefined}
                      />
                    )}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500">
                    {previewNote
                      ? `No preview: ${previewNote} Enter the region below instead.`
                      : 'Loading a preview of the source...'}
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  {previewUrl
                    ? 'Drag a rectangle to import only that patch, or click once to go back to the whole image.'
                    : 'Leave these at the full extent to import the whole image.'}
                </p>

                <div className="flex gap-2 mt-2">
                  {numberField('X', region ? region.x : 0, 0, probe.width - 1, (v) =>
                    patchRegion({ x: v }),
                  )}
                  {numberField('Y', region ? region.y : 0, 0, probe.height - 1, (v) =>
                    patchRegion({ y: v }),
                  )}
                  {numberField('Width', width, 1, probe.width, (v) => patchRegion({ width: v }))}
                  {numberField('Height', height, 1, probe.height, (v) =>
                    patchRegion({ height: v }),
                  )}
                </div>
              </div>

              {channelNote && (
                <div className="p-3 rounded-lg border text-xs bg-amber-50 border-amber-200 text-amber-800">
                  {channelNote}
                </div>
              )}

              {bytes > 0 && (
                <div
                  className={`p-3 rounded-lg border text-xs ${
                    tooLargeToCopy
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-gray-50 border-gray-200 text-gray-600'
                  }`}
                >
                  {tooLargeToCopy ? (
                    <>
                      This is about {formatBytes(bytes)} at full resolution, over the{' '}
                      {formatBytes(probe.max_materialise_bytes)} the browser can copy in one piece. You can still link
                      and annotate it, but training needs a copy, so pick a smaller region to train on it.
                    </>
                  ) : (
                    <>
                      About {formatBytes(bytes)} at full resolution, copied into this dataset on the first annotation.
                    </>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="ngff-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Name in this dataset <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  id="ngff-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  placeholder={probe.stem || 'Taken from the URL when left empty'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
                />
              </div>
            </>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700 whitespace-pre-wrap break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="p-6 pt-4 flex justify-end gap-3 border-t border-gray-200/50">
          <button
            type="button"
            onClick={probe ? handleBack : onClose}
            disabled={busy}
            className="px-5 py-2.5 text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 text-sm font-medium transition-colors active:scale-[0.98]"
          >
            {probe ? 'Back' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={busy || !storeRoot.trim()}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium shadow-sm flex items-center gap-2 transition-colors active:scale-[0.98]"
          >
            {busy && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {checking && 'Checking the source...'}
            {importing && 'Linking...'}
            {!busy && (probe ? (region ? 'Link this region' : 'Link image') : 'Check source')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ImportRemoteSourceModal;
