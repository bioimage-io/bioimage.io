import React from 'react';
import { Link } from 'react-router-dom';
import { useCampaign } from '../../hooks/useCampaign';
import ContributorRoster from './ContributorRoster';
import SiteRoster from './SiteRoster';
import TransportAudit from './TransportAudit';
import { formatCount } from './format';
import { Value } from './MissingValue';

/**
 * Provenance section for a model that came out of a federation campaign.
 *
 * A federated model is an ordinary Zoo model: same tests, same review, same
 * page. What it carries in addition is where it was trained and what moved
 * while it was, which is what this section shows.
 *
 * Renders nothing at all when the model does not link a campaign, or when the
 * campaign service cannot be reached. A model page must not sprout an empty
 * "provenance" box because a service was down.
 */

/**
 * Reads the campaign link out of an RDF manifest.
 *
 * Both shapes are accepted because the field is still being settled with the
 * campaign service: a bare id, or an object that may later carry more.
 */
export function getCampaignIdFromManifest(manifest: any): string | null {
  const config = manifest?.config;
  if (!config) return null;
  if (typeof config.federation_campaign_id === 'string') return config.federation_campaign_id;
  if (typeof config.federation_campaign?.campaign_id === 'string') {
    return config.federation_campaign.campaign_id;
  }
  return null;
}

const FederatedProvenance: React.FC<{ campaignId: string }> = ({ campaignId }) => {
  const { data, loading, error } = useCampaign(campaignId);

  // Silent on failure by design. The alternative is an empty labelled box that
  // implies the model has no provenance when in fact the service was down.
  if (loading || error || !data) return null;

  const progress = data.progress;
  const async = progress.mode === 'asynchronous';

  return (
    <section className="mt-8 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {async ? 'Trained by a community' : 'Trained across institutions'}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {async
              ? 'This model was fine-tuned by contributors on their own data, and the results were averaged into it. The training images stayed where they were.'
              : 'This model was produced by a federation campaign. The images it learned from never left the sites that hold them.'}
          </p>
        </div>
        <Link
          to={`/campaigns/${data.campaign_id}`}
          className="flex-shrink-0 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 ease-out hover:border-gray-400 hover:shadow active:scale-[0.97]"
        >
          View campaign
        </Link>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">
            {async ? 'Contributors' : 'Sites'}
          </dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
            <Value>
              {formatCount(
                progress.mode === 'synchronous'
                  ? progress.sites.length
                  : progress.contributors.length
              )}
            </Value>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">
            {async ? 'Contributions merged' : 'Rounds'}
          </dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
            <Value>
              {formatCount(
                progress.mode === 'synchronous'
                  ? progress.rounds.length
                  : // Counted off the contributions, not off the soups. A merge
                    // count answers a different question ("how often was the
                    // model updated") and would understate the training that
                    // went into this checkpoint by roughly its fold size.
                    progress.contributions.filter((c) => c.disposition === 'included').length
              )}
            </Value>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Aggregation</dt>
          <dd className="mt-0.5 font-medium text-gray-800">
            {data.aggregation.method}, {data.aggregation.weighting} weighting
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Data licences</dt>
          <dd className="mt-0.5 font-medium text-gray-800">
            <Value>{data.licence_policy.accepted_data_licences.join(', ') || null}</Value>
          </dd>
        </div>
      </dl>

      <div className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          Transport audit
        </h3>
        <div className="mt-3">
          <TransportAudit
            transport={data.transport}
            payload={data.payload}
            mode={progress.mode}
            compact
          />
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          {async ? 'Contributors' : 'Contributing sites'}
        </h3>
        <div className="mt-3">
          {progress.mode === 'synchronous' ? (
            <SiteRoster sites={progress.sites} rosterAttested={data.policy?.roster_attested} />
          ) : (
            <ContributorRoster
              contributors={progress.contributors}
              rosterAttested={data.policy?.roster_attested}
            />
          )}
        </div>
      </div>
    </section>
  );
};

export default FederatedProvenance;
