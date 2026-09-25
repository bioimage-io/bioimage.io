import React from 'react';
import { useNavigate } from 'react-router-dom';
import BioEnginePageHeader from './BioEnginePageHeader';
import BioEngineGuide from './BioEngineGuide';

/**
 * `/bioengine/worker-setup` — standing up a new worker.
 *
 * The configurator itself is unchanged; this page only gives it a route of its
 * own and the shared header. `BioEngineGuide` reads `?mode=human|ai-agent` for
 * the audience toggle, so `/bioengine/worker-setup?mode=ai-agent` links
 * straight to the agent prompt.
 */
const BioEngineWorkerSetup: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <BioEnginePageHeader backTo="/bioengine" />

      <div className="max-w-6xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200">
          {/* The guide's "already have a worker?" affordance used to scroll to a
              button on the old combined page. That button is now its own route,
              so send people there instead of scrolling. */}
          <BioEngineGuide onScrollToWorkers={() => navigate('/bioengine/worker-admin')} />
        </div>
      </div>
    </div>
  );
};

export default BioEngineWorkerSetup;
