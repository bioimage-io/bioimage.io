import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Small anchored info popover: click an (i) icon to reveal a short tip near
 *  the trigger. Rendered through a portal into document.body so `position:
 *  fixed` coordinates resolve against the real viewport, not an ancestor
 *  with a `backdrop-filter`/`filter`/`transform` that would otherwise create
 *  its own containing block. */
const PANEL_WIDTH = 288;
/** Gap between the trigger and the panel, and between the panel and the
 *  viewport edge. */
const GAP = 6;
const EDGE = 8;
/** Below this much room, opening downwards is not worth it even if the panel
 *  would technically fit after being clamped and scrolled. */
const MIN_ROOM = 160;

type Placement = { left: number; top?: number; bottom?: number; maxHeight: number };

const InfoPopover: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>({ left: 0, top: 0, maxHeight: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // The panel is `position: fixed` and anchored to where the trigger was, so
    // once the page moves underneath it the two come apart. Closing is both
    // cheaper and less surprising than chasing the trigger.
    //
    // Capture is required to see scrolls from nested scroll containers (scroll
    // does not bubble), but that also catches the panel scrolling ITSELF once
    // its content is clamped. Closing on that would put the clamped text out
    // of reach, which is the very thing the clamp exists to prevent.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (panelRef.current && target && panelRef.current.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const togglePopover = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const left = Math.max(Math.min(rect.left, window.innerWidth - PANEL_WIDTH - EDGE), EDGE);
      const roomBelow = window.innerHeight - rect.bottom - GAP - EDGE;
      const roomAbove = rect.top - GAP - EDGE;
      // Open downwards by default, but flip above the trigger when the content
      // would otherwise run off the bottom. A fixed panel cannot be scrolled
      // into view, so anything past the fold is simply unreachable.
      if (roomBelow < MIN_ROOM && roomAbove > roomBelow) {
        setPlacement({ left, bottom: window.innerHeight - rect.top + GAP, maxHeight: roomAbove });
      } else {
        setPlacement({ left, top: rect.bottom + GAP, maxHeight: roomBelow });
      }
    }
    setOpen(!open);
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={togglePopover}
        aria-label={label}
        className="text-gray-400 hover:text-blue-600 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: placement.top,
              bottom: placement.bottom,
              left: placement.left,
              zIndex: 999,
              width: `${PANEL_WIDTH}px`,
              maxHeight: placement.maxHeight,
              overflowY: 'auto',
            }}
            className="bg-white rounded-lg shadow-lg border border-gray-200 p-3 text-xs text-gray-700"
          >
            {children}
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default InfoPopover;
