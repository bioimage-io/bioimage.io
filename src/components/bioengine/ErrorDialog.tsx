import React, { useEffect, useState } from 'react';

interface ErrorDialogProps {
  open: boolean;
  // Short header label, e.g. "Deployment failed", "Cache delete failed".
  title: string;
  // Optional one-line context shown beneath the title (e.g. artifact id).
  subtitle?: string;
  // The full error text. Worker / app errors can be multi-line stack traces;
  // the dialog body is scrollable so even very long traces stay usable.
  message: string;
  onClose: () => void;
}

// A reusable modal for surfacing errors that come back from a BioEngine
// worker or app. Replaces inline red banners and toasts that would either
// truncate long stack traces or push other content around. Stacks above
// existing dialogs (z-60) so it can be opened from inside the deployment
// status dialog (z-50). Centered with `transform-origin: center` per the
// design rules — modals aren't anchored to a trigger.
const ErrorDialog: React.FC<ErrorDialogProps> = ({
  open,
  title,
  subtitle,
  message,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  // ESC dismisses. Only attaches the listener while the dialog is open so
  // we don't intercept ESC for the rest of the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset the "Copied" pill state whenever the dialog re-opens with a new
  // message, otherwise it'd stay sticky from the previous error.
  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API permission
      const ta = document.createElement('textarea');
      ta.value = message;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* swallow — best-effort */
      }
      document.body.removeChild(ta);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      style={{
        zIndex: 60,
        animation: 'errorDialogBackdropFade 180ms cubic-bezier(0.23, 1, 0.32, 1)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-dialog-title"
    >
      <style>{`
        @keyframes errorDialogBackdropFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes errorDialogContentIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .err-press { transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
        .err-press:active:not(:disabled) { transform: scale(0.97); }
      `}</style>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        style={{ animation: 'errorDialogContentIn 200ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-start gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 bg-red-50 border border-red-200 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-2.99l-7.07-12.24a2 2 0 00-3.48 0L3.19 16.01A2 2 0 004.93 19z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 id="error-dialog-title" className="text-base font-semibold text-gray-900 break-words">
                {title}
              </h3>
              {subtitle && (
                <p className="text-xs text-gray-500 mt-0.5 break-all">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="err-press text-gray-400 hover:text-gray-600 flex-shrink-0 -mr-1 -mt-1 p-1"
            aria-label="Close error dialog"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body — the actual error text. Rendered in a <pre> so
            whitespace and multi-line stack traces survive intact; word-wrap
            kicks in for very long lines so the user never has to scroll
            horizontally. */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <pre className="text-xs text-gray-800 whitespace-pre-wrap break-words font-mono leading-relaxed">
            {message || '(no error message returned)'}
          </pre>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={handleCopy}
            className={`err-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border ${
              copied
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {copied ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-2a2 2 0 00-2 2v8a2 2 0 01-2 2z" />
              )}
            </svg>
            {copied ? 'Copied' : 'Copy error'}
          </button>
          <button
            onClick={onClose}
            className="err-press px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorDialog;
