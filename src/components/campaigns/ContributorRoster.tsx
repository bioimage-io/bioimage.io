import React from 'react';
import { ContributorRecord, DeclaredSiteField } from '../../types/campaign';
import { formatCount, formatDate } from './format';
import MissingValue, { Value } from './MissingValue';

/**
 * The contributor list for an asynchronous campaign.
 *
 * Deliberately NOT SiteRoster with different column headings. The two tables
 * describe different things and the difference is load-bearing:
 *
 *   A synchronous site has an ACTIVITY, because there is a current round and a
 *   site either reported into it or did not. An async contributor has no such
 *   state. Nothing is in flight for them to be late for. The honest column is
 *   when they last contributed, and how often, and a reader can decide for
 *   themselves what counts as active.
 *
 *   A synchronous site joined AT A ROUND. An async contributor joined on a
 *   date, because there is no round index to join at.
 *
 * Reusing the one table with an `activity` column forced to null would have
 * rendered "Not reported" for a state that does not exist in this campaign,
 * which points a reader at a gap in the record rather than at a difference in
 * how the campaign runs.
 *
 * The declared-versus-measured discipline carries over unchanged, including the
 * three-state provenance: an absent `declared` list is the absence of evidence
 * either way and must not resolve to "measured".
 */

type Provenance = 'declared' | 'measured' | 'unknown';

function provenanceOf(contributor: ContributorRecord, field: DeclaredSiteField): Provenance {
  if (!contributor.declared) return 'unknown';
  return contributor.declared.includes(field) ? 'declared' : 'measured';
}

const ProvenanceMark: React.FC<{
  contributor: ContributorRecord;
  field: DeclaredSiteField;
}> = ({ contributor, field }) => {
  const provenance = provenanceOf(contributor, field);
  if (provenance === 'measured') return null;
  return (
    <span
      className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-gray-400"
      data-provenance={provenance}
      title={
        provenance === 'declared'
          ? 'Declared by the contributor when they joined, not measured by the platform.'
          : 'This contributor did not report where their values came from, so the page cannot say whether this was declared on a join form or measured by the platform.'
      }
    >
      {provenance === 'declared' ? 'declared' : 'source not stated'}
    </span>
  );
};

export interface ContributorRosterProps {
  contributors: ContributorRecord[];
  /**
   * From the campaign's `policy.roster_attested`. Null means the service did
   * not say, which is treated exactly like false.
   */
  rosterAttested?: boolean | null;
}

const ContributorRoster: React.FC<ContributorRosterProps> = ({
  contributors,
  rosterAttested = null,
}) => {
  if (contributors.length === 0) {
    return <p className="text-sm text-gray-500">Nobody has contributed to this campaign yet.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th scope="col" className="py-2 pr-4 font-semibold">Contributor</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Data it holds</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Training images</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Contributions</th>
              <th scope="col" className="py-2 font-semibold">Last contributed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {contributors.map((contributor) => (
              <tr
                key={contributor.contributor_id}
                className="align-top transition-colors duration-200 hover:bg-gray-50/80"
              >
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900">{contributor.contributor_name}</div>
                  <div className="text-xs text-gray-500">
                    <Value reason="undeclared" label="Location not declared">
                      {contributor.country}
                    </Value>
                    {contributor.country && (
                      <ProvenanceMark contributor={contributor} field="country" />
                    )}
                  </div>
                  {contributor.joined_at && (
                    <div className="text-xs text-gray-400">
                      Joined {formatDate(contributor.joined_at)}
                    </div>
                  )}
                </td>
                <td className="py-3 pr-4 text-gray-700">
                  {contributor.datasets.length === 0 ? (
                    <Value>{null}</Value>
                  ) : (
                    <ul className="space-y-1">
                      {contributor.datasets.map((dataset) => (
                        <li key={dataset.name}>
                          <span className="font-medium text-gray-800">{dataset.name}</span>
                          {dataset.objects && (
                            <span className="text-gray-500"> ({dataset.objects})</span>
                          )}
                          {dataset.licence && (
                            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                              {dataset.licence}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-3 pr-4 tabular-nums text-gray-700">
                  <Value reason="withheld">{formatCount(contributor.n_train_images)}</Value>
                  {contributor.n_train_images !== null && (
                    <ProvenanceMark contributor={contributor} field="n_train_images" />
                  )}
                </td>
                <td className="py-3 pr-4 tabular-nums text-gray-700">
                  <Value>{formatCount(contributor.n_contributions)}</Value>
                </td>
                <td className="py-3 text-gray-700">
                  {/* No "active" or "idle" pill. Whether a fortnight of silence
                      means a contributor has stopped or is midway through a long
                      run is not in the record, and a pill would have to decide.
                      The date is what is known. */}
                  {/* "Has not contributed yet" and "the service did not say
                      when they last contributed" are different claims, and only
                      the count can tell them apart. Routing the first through
                      MissingValue would have attached a tooltip blaming the
                      service for an absence the record fully explains. */}
                  {contributor.latest_contribution_at ? (
                    <span className="whitespace-nowrap">
                      {formatDate(contributor.latest_contribution_at)}
                    </span>
                  ) : contributor.n_contributions === 0 ? (
                    <span className="text-gray-500">No contributions yet</span>
                  ) : (
                    <MissingValue />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rosterAttested === true ? (
        <p className="mt-3 text-xs text-gray-500">
          Each entry is tied to the credential the contributor joined with, so this list records who
          took part.
        </p>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          Contributor names are self-declared. The platform does not verify that a participant
          belongs to the institution they name, so this is a list of participants rather than an
          attested membership record.
        </p>
      )}
    </div>
  );
};

export default ContributorRoster;
