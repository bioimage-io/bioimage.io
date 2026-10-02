import React from 'react';
import { useNavigate } from 'react-router-dom';
import BioEnginePageHeader from './BioEnginePageHeader';
import BioEngineGitHubLink from './BioEngineGitHubLink';
import BioEngineStepIllustration, { StepIllustrationVariant } from './BioEngineStepIllustration';
import BioEngineArchitectureDiagram from './BioEngineArchitectureDiagram';
import './bioengine-landing.css';

/**
 * Landing page for `/bioengine`.
 *
 * Previously this rendered the worker-setup wizard inline, which served only
 * the people standing up their own worker and hid the two other reasons to be
 * here: administering a worker that already exists, and calling apps already
 * deployed on one. Those three routes are now framed as a numbered journey, so
 * the page answers "where am I in this" as well as "where do I click".
 *
 * Below the journey sit the two things people kept having to be told in person:
 * that tokens are handled for them everywhere except their own scripts, and how
 * the pieces actually fit together. Both are on the page now instead of in a
 * README.
 */

type Step = {
  number: string;
  to: string;
  title: string;
  blurb: string;
  cta: string;
  variant: StepIllustrationVariant;
  /** Tailwind classes for the per-step accent: badge, call to action, frame. */
  badge: string;
  action: string;
  frame: string;
};

const STEPS: Step[] = [
  {
    number: '01',
    to: '/bioengine/worker-setup?mode=ai-agent',
    title: 'Set up a worker',
    blurb:
      'Run BioEngine on your own machine, an HPC allocation or a Kubernetes cluster. Step through the configurator yourself, or hand the job to an AI agent.',
    cta: 'Start setup',
    variant: 'setup',
    badge: 'bg-blue-50 text-blue-700',
    action: 'text-blue-700',
    frame: 'border-blue-100 bg-blue-50/40',
  },
  {
    number: '02',
    to: '/bioengine/worker-admin',
    title: 'Administer a worker',
    blurb:
      'Deploy and manage applications on a worker you have admin rights to. Pick the workers you look after and hand an AI agent a prompt that already knows about them.',
    cta: 'Manage workers',
    variant: 'admin',
    badge: 'bg-purple-50 text-purple-700',
    action: 'text-purple-700',
    frame: 'border-purple-100 bg-purple-50/40',
  },
  {
    number: '03',
    to: '/bioengine/apps',
    title: 'Use deployed apps',
    blurb:
      'Call applications that are already running, public or your own. Browse what is deployed across the workspaces you follow and copy their service ids into an AI agent.',
    cta: 'Browse apps',
    variant: 'apps',
    badge: 'bg-cyan-50 text-cyan-700',
    action: 'text-cyan-700',
    frame: 'border-cyan-100 bg-cyan-50/40',
  },
];

const FACTS = [
  {
    dot: 'bg-purple-500',
    title: 'Hypha is the hub',
    body:
      'Browsers, desktop tools and AI agents all connect to the same public Hypha server, hosted at KTH in Stockholm, Sweden. Nothing has to reach a worker directly.',
  },
  {
    dot: 'bg-blue-500',
    title: 'Ray does the scaling',
    body:
      'Every worker is built on Ray, so one BioEngine setup covers a laptop today and an institutional cluster behind Kubernetes or SLURM tomorrow.',
  },
  {
    dot: 'bg-cyan-500',
    title: 'A public worker to start on',
    body:
      'The public bioimage-io worker runs at KTH as well. You can call the apps deployed on it right away and bring your own hardware online later.',
  },
];

/**
 * The chevron that turns three cards into one pipeline on wide screens.
 *
 * It is anchored to the illustration band rather than to the grid, which keeps
 * it level with the artwork at every width without any calc() that has to
 * re-derive the column geometry. The 33px offset is the card's padding (20) plus
 * its border (1) plus half the 24px grid gap (12), so the chevron lands dead
 * centre in the gap.
 */
const StepConnector: React.FC = () => (
  <span
    aria-hidden="true"
    className="hidden md:block absolute top-1/2 text-gray-400"
    style={{ right: '-33px', transform: 'translate(50%, -50%)' }}
  >
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  </span>
);

const BioEngineHome: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-[1400px] mx-auto px-4 pt-6 pb-10">
      <BioEnginePageHeader />

      <p className="max-w-2xl mx-auto -mt-5 mb-8 text-center text-[1.05rem] leading-relaxed text-gray-600">
        BioEngine is the execution layer for bioimage AI. It keeps models loaded on GPU workers and
        answers calls in real time, from a single laptop to an institutional cluster.
      </p>

      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map((step, i) => (
            <button
              key={step.to}
              type="button"
              onClick={() => navigate(step.to)}
              className="be-step-card group text-left bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-5 flex flex-col hover:shadow-md hover:border-blue-200 active:scale-[0.99] transition-[box-shadow,border-color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <div className={`relative mb-4 rounded-xl border ${step.frame}`}>
                <BioEngineStepIllustration variant={step.variant} />
                {i < STEPS.length - 1 && <StepConnector />}
              </div>

              <div className="flex items-center gap-2.5 mb-2">
                <span className={`text-xs font-bold tracking-wider px-2 py-1 rounded-md ${step.badge}`}>
                  {step.number}
                </span>
                <h2 className="text-lg font-semibold text-gray-800">{step.title}</h2>
              </div>

              <p className="text-sm text-gray-600 leading-relaxed flex-grow">{step.blurb}</p>

              <span className={`mt-4 inline-flex items-center gap-1.5 text-sm font-semibold ${step.action}`}>
                {step.cta}
                <svg
                  className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tokens are the one thing people ask about that is not a step. Quieter
          than the cards, loud enough to find without being told it exists. */}
      <div className="max-w-6xl mx-auto mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-3.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </span>
          <p className="flex-grow text-sm text-gray-600 leading-relaxed">
            <span className="font-semibold text-gray-800">Hypha tokens are handled for you.</span>{' '}
            All three steps above sign you in and pass your token along. You only need to generate
            one by hand when you drive BioEngine from your own scripts or AI agents.
          </p>
          <button
            type="button"
            onClick={() => navigate('/bioengine/token')}
            className="flex-shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-700 active:scale-[0.98] transition-[color,border-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Generate token
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>

      <section className="max-w-6xl mx-auto mt-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold text-gray-800">How BioEngine works</h2>
          <p className="mt-2 max-w-2xl mx-auto text-sm text-gray-600 leading-relaxed">
            One public hub, many workers. Clients do not talk to a worker directly. They call Hypha,
            and Hypha routes the work to whichever machine is running the application.
          </p>
        </div>

        <div className="rounded-2xl border border-white/20 bg-white/80 backdrop-blur-sm shadow-sm p-4 sm:p-6">
          <BioEngineArchitectureDiagram />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-6">
          {FACTS.map(fact => (
            <div key={fact.title} className="rounded-xl border border-gray-100 bg-white/70 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-2 h-2 rounded-full ${fact.dot}`} aria-hidden="true" />
                <h3 className="text-sm font-semibold text-gray-800">{fact.title}</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{fact.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="max-w-6xl mx-auto mt-14 pt-6 border-t border-gray-200 flex justify-center">
        <BioEngineGitHubLink />
      </div>
    </div>
  );
};

export default BioEngineHome;
