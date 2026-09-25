import React, { useState } from 'react';

/**
 * The "Paste this into your AI agent." panel.
 *
 * The worker-setup wizard grew this pattern first; the admin and apps pages
 * need the same thing with a different prompt and, unlike setup, a prompt that
 * is only meaningful once the user has selected something. Rather than copy the
 * markup a third time it lives here, with the selection gate built in.
 *
 * `disabled` blocks the copy outright instead of letting someone copy a prompt
 * that names nothing, which would send an agent off with no target.
 */
const AgentPromptBox: React.FC<{
  title: string;
  intro: string;
  prompt: string;
  disabled?: boolean;
  disabledHint?: string;
  selectionSummary?: string;
  /** Rendered under the prompt, e.g. the full-service-id checkbox. */
  children?: React.ReactNode;
}> = ({ title, intro, prompt, disabled, disabledHint, selectionSummary, children }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      /* clipboard denied; the prompt is selectable on screen regardless */
    }
  };

  return (
    <div className="space-y-4">
      {/* Intro only. The heading used to repeat the title that the grey box
          below already carries, so it said the same thing twice. */}
      <div className="p-5 bg-blue-50 rounded-xl border border-blue-200">
        <p className="text-sm text-blue-800">{intro}</p>
      </div>

      <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="flex items-center justify-between mb-2 gap-3">
          <h5 className="text-sm font-semibold text-gray-800">{title}</h5>
          <div className="flex items-center gap-2">
            {selectionSummary && (
              <span className={`text-xs ${disabled ? 'text-amber-700' : 'text-gray-500'}`}>
                {selectionSummary}
              </span>
            )}
            <button
              type="button"
              onClick={copy}
              disabled={disabled}
              title={disabled ? disabledHint : 'Copy the prompt'}
              className={`flex items-center px-2 py-1 text-xs rounded border transition-colors ${
                disabled
                  ? 'text-gray-400 bg-gray-100 border-gray-200 cursor-not-allowed'
                  : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-100'
              }`}
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-700 mb-3">
          {disabled && disabledHint ? disabledHint : 'Paste this into your AI agent.'}
        </p>
        <pre className="bg-white border border-gray-200 rounded p-3 text-xs font-mono text-gray-800 whitespace-pre-wrap break-words max-h-72 overflow-auto">
          {prompt}
        </pre>
        {children}
      </div>
    </div>
  );
};

export default AgentPromptBox;
