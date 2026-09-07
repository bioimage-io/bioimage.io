import React from 'react';
import { DeclaredSiteField, SiteActivity, SiteRecord } from '../../types/campaign';
import { formatCount } from './format';
import MissingValue, { Value } from './MissingValue';

/**
 * The roster of participating sites.
 *
 * Two things this table is careful about.
 *
 * Site names are self-declared: the platform does not verify that a
 * participating deployment belongs to the institution it names. The footnote
 * says so, because a table of institution names reads as an attested membership
 * list unless it explicitly is not one. The wording is keyed off the campaign's
 * `roster_attested` flag rather than hardcoded, so it disappears when
 * per-deployment credentials land and not one release before.
 *
 * Declared and measured values are not interchangeable. A value the site typed
 * into a join form is marked as such, so a reader can tell it from something
 * the platform observed without having to know which columns are which.
 */

// Only the states the driver can actually back. There is no 'training' or
// 'unreachable' pill because nothing records them: producing either would mean
// polling a live per-site call, which contradicts the snapshot the rest of this
// record is and goes blank the moment a campaign ends.
const ACTIVITY_STYLES: Record<SiteActivity, { label: string; className: string }> = {
  reported: { label: 'Reported', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  idle: { label: 'Idle', className: 'bg-gray-50 text-gray-600 border-gray-200' },
  pending_review: { label: 'Awaiting review', className: 'bg-amber-50 text-amber-800 border-amber-200' },
};

const ActivityPill: React.FC<{ activity: SiteActivity | null }> = ({ activity }) => {
  const style = activity ? ACTIVITY_STYLES[activity] : undefined;
  if (!style) return <MissingValue />;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
};

/**
 * Where a rendered value came from.
 *
 * `declared` is the only mechanism separating a figure the site typed into a
 * join form from one the platform observed, so an absent `declared` list must
 * not resolve to "measured". It used to: the check was
 * `site.declared?.includes(field) ?? false`, and the mark is the sole visual
 * difference between the two, so a site that reported no provenance at all had
 * every one of its values presented as platform-measured. The weaker-evidence
 * marker failed open toward the stronger claim, which is the one direction it
 * must never fail in.
 *
 * Three states, because the record genuinely has three. A missing list is not
 * evidence of measurement, it is the absence of evidence either way, and the
 * page has no basis for choosing between them.
 */
type Provenance = 'declared' | 'measured' | 'unknown';

function provenanceOf(site: SiteRecord, field: DeclaredSiteField): Provenance {
  if (!site.declared) return 'unknown';
  return site.declared.includes(field) ? 'declared' : 'measured';
}

/**
 * Marks how a value was obtained. Renders nothing for a measured value, which
 * is the unmarked default the columns are read against.
 */
const ProvenanceMark: React.FC<{ site: SiteRecord; field: DeclaredSiteField }> = ({
  site,
  field,
}) => {
  const provenance = provenanceOf(site, field);
  if (provenance === 'measured') return null;
  return (
    <span
      className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-gray-400"
      data-provenance={provenance}
      title={
        provenance === 'declared'
          ? 'Declared by the site on its join form, not measured by the platform.'
          : 'This site did not report where its values came from, so the page cannot say whether this was declared on a join form or measured by the platform.'
      }
    >
      {provenance === 'declared' ? 'declared' : 'source not stated'}
    </span>
  );
};

interface SiteRosterProps {
  sites: SiteRecord[];
  /** Shown as a "joined at round N" column when the campaign has a round counter. */
  showJoinedRound?: boolean;
  /**
   * From the campaign's `policy.roster_attested`. Null means the service did
   * not say, which is treated exactly like false: the caveat stays up until
   * something affirmatively says attestation exists.
   */
  rosterAttested?: boolean | null;
}

const SiteRoster: React.FC<SiteRosterProps> = ({
  sites,
  showJoinedRound = true,
  rosterAttested = null,
}) => {
  if (sites.length === 0) {
    return (
      <p className="text-sm text-gray-500">No sites are on this roster yet.</p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th scope="col" className="py-2 pr-4 font-semibold">Site</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Data it holds</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Training images</th>
              {showJoinedRound && (
                <th scope="col" className="py-2 pr-4 font-semibold">Joined</th>
              )}
              <th scope="col" className="py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sites.map((site) => (
              <tr key={site.site_id} className="align-top transition-colors duration-200 hover:bg-gray-50/80">
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900">{site.site_name}</div>
                  <div className="text-xs text-gray-500">
                    <Value reason="undeclared" label="Location not declared">{site.country}</Value>
                    {site.country && <ProvenanceMark site={site} field="country" />}
                  </div>
                </td>
                <td className="py-3 pr-4 text-gray-700">
                  {site.datasets.length === 0 ? (
                    <Value>{null}</Value>
                  ) : (
                    <ul className="space-y-1">
                      {site.datasets.map((dataset) => (
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
                  {/* Null here is withholding, not silence. The schema records
                      that uniform-weight campaigns do not publish per-site
                      training-set sizes, so pointing a reader at the service is
                      pointing them at the wrong thing. */}
                  <Value reason="withheld">{formatCount(site.n_train_images)}</Value>
                  {site.n_train_images !== null && (
                    <ProvenanceMark site={site} field="n_train_images" />
                  )}
                </td>
                {showJoinedRound && (
                  <td className="py-3 pr-4 tabular-nums text-gray-700">
                    {site.joined_round === null ? (
                      <Value>{null}</Value>
                    ) : site.joined_round === 0 ? (
                      <span className="text-gray-500">At the start</span>
                    ) : (
                      <span>Round {site.joined_round}</span>
                    )}
                  </td>
                )}
                <td className="py-3">
                  <ActivityPill activity={site.activity} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rosterAttested === true ? (
        <p className="mt-3 text-xs text-gray-500">
          Each entry is tied to the credential the deployment joined with, so this roster records
          which deployments took part.
        </p>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          Site names are self-declared by each participating deployment. The platform does not
          verify that a deployment belongs to the institution it names, so this is a list of
          participants rather than an attested membership record.
        </p>
      )}
    </div>
  );
};

export default SiteRoster;
