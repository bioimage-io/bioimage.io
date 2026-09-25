import React from 'react';
import { useNavigate } from 'react-router-dom';
import BioEnginePageHeader from './BioEnginePageHeader';

/**
 * Landing page for `/bioengine`.
 *
 * Previously this rendered the worker-setup wizard inline, which served only
 * the people standing up their own worker and hid the two other reasons to be
 * here: administering a worker that already exists, and calling apps already
 * deployed on one. The three routes are now the first thing on the page.
 */

type Choice = {
  to: string;
  title: string;
  blurb: string;
  cta: string;
  icon: React.ReactNode;
  accent: string;
};

const CHOICES: Choice[] = [
  {
    to: '/bioengine/worker-setup?mode=ai-agent',
    title: 'Set up a worker',
    blurb:
      'Run BioEngine on your own machine, an HPC allocation or a Kubernetes cluster. Step through the configurator yourself, or hand the job to an AI agent.',
    cta: 'Start setup',
    accent: 'from-blue-600 to-blue-700',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    ),
  },
  {
    to: '/bioengine/worker-admin',
    title: 'Administer a worker',
    blurb:
      'Deploy and manage applications on a worker you have admin rights to. Pick the workers you look after and hand an AI agent a prompt that already knows about them.',
    cta: 'Manage workers',
    accent: 'from-purple-600 to-purple-700',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    ),
  },
  {
    to: '/bioengine/apps',
    title: 'Use deployed apps',
    blurb:
      'Call applications that are already running, public or your own. Browse what is deployed across the workspaces you follow and copy their service ids into an AI agent.',
    cta: 'Browse apps',
    accent: 'from-cyan-600 to-cyan-700',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    ),
  },
];

const BioEngineHome: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <BioEnginePageHeader />

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {CHOICES.map(choice => (
          <button
            key={choice.to}
            type="button"
            onClick={() => navigate(choice.to)}
            className="group text-left bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 flex flex-col hover:shadow-md hover:border-blue-200 active:scale-[0.99] transition-all duration-200"
          >
            <div className={`w-11 h-11 rounded-xl mb-4 flex items-center justify-center bg-gradient-to-r ${choice.accent}`}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {choice.icon}
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">{choice.title}</h2>
            <p className="text-sm text-gray-600 flex-grow">{choice.blurb}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:gap-2.5 transition-all">
              {choice.cta}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </span>
          </button>
        ))}
      </div>

      {/* Secondary route. Useful on its own, but not one of the three things
          people come here to do, so it sits below rather than as a fourth card. */}
      <div className="max-w-6xl mx-auto mt-6 text-center">
        <button
          type="button"
          onClick={() => navigate('/bioengine/token')}
          className="text-sm text-gray-600 hover:text-blue-700 underline transition-colors"
        >
          Generate a Hypha token
        </button>
      </div>
    </div>
  );
};

export default BioEngineHome;
