import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The BioEngine wordmark, shared by every page under `/bioengine`.
 *
 * Lifted verbatim out of `BioEngineHome` when that page became a landing page
 * for three separate audiences: the logo, the gradient title and the caption
 * are the one constant across setup, admin, apps and token, so they live in one
 * place rather than being copied four times and drifting apart.
 *
 * `backTo` renders a back link on the sub-pages. The landing page omits it.
 */
const BioEnginePageHeader: React.FC<{
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
}> = ({ subtitle, backTo, backLabel = 'All BioEngine options' }) => {
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto mb-8">
      {backTo && (
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="inline-flex items-center mb-4 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-sm font-medium">{backLabel}</span>
        </button>
      )}
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-1">
          <img src="/static/img/bioengine-icon.svg" alt="BioEngine Logo" className="w-[2.7rem] h-[2.7rem]" />
          <h1 className="text-[2.7rem] font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent tracking-tight">
            BioEngine
          </h1>
        </div>
        <p className="text-[1.05rem] text-gray-600">
          Unveiling cloud-powered AI for simplified Bioimage Analysis
        </p>
        {subtitle && (
          <p className="mt-3 text-sm text-gray-500 max-w-2xl mx-auto">{subtitle}</p>
        )}
      </div>
    </div>
  );
};

export default BioEnginePageHeader;
