import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Small anchored info popover: click an (i) icon to reveal a short tip near
 *  the trigger. Rendered through a portal into document.body so `position:
 *  fixed` coordinates resolve against the real viewport, not an ancestor
 *  with a `backdrop-filter`/`filter`/`transform` that would otherwise create
 *  its own containing block. */
const InfoPopover: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const togglePopover = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 288;
      const left = Math.min(rect.left, window.innerWidth - panelWidth - 8);
      setPosition({ top: rect.bottom + 6, left: Math.max(left, 8) });
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
            style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 999, width: '288px' }}
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
