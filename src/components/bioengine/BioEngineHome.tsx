import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BioEngineGuide from './BioEngineGuide';

const BioEngineHome: React.FC = () => {
  const navigate = useNavigate();
  const workersButtonRef = useRef<HTMLButtonElement>(null);
  const [highlightWorkersButton, setHighlightWorkersButton] = useState(false);

  const scrollToWorkersButton = () => {
    workersButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightWorkersButton(true);
    setTimeout(() => setHighlightWorkersButton(false), 1600);
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header. Same scale and rhythm as the Colab page header: centred title
          with the subtitle directly under it, actions in the right-hand slot.
          Constrained to the configurator's width so the button lines up with
          the right edge of the box below it. */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div className="flex-1" />
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
          </div>
          <div className="flex-1 flex justify-end">
            <button
              ref={workersButtonRef}
              onClick={() => navigate('/bioengine/worker')}
              className={`inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl shadow-md hover:shadow-lg hover:from-blue-700 hover:to-purple-700 active:scale-[0.98] transition-all duration-200 text-sm font-semibold ${highlightWorkersButton ? 'ring-4 ring-blue-300 ring-offset-2' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
              View BioEngine Workers
            </button>
          </div>
        </div>
      </div>

      {/* Deployment configurator */}
      <div className="max-w-6xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200">
          <BioEngineGuide onScrollToWorkers={scrollToWorkersButton} />
        </div>
      </div>
    </div>
  );
};

export default BioEngineHome;
