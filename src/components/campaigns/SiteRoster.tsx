import React from 'react';
import { SiteActivity, SiteRecord } from '../../types/campaign';
import { formatCount } from './format';
import { Value } from './MissingValue';

/**
 * The roster of participating sites.
 *
 * Site names are self-declared: the platform does not verify that a
 * participating deployment belongs to the institution it names. The footnote
 * says so on every render, because a table of institution names reads as an
 * attested membership list unless it explicitly is not one.
 */

const ACTIVITY_STYLES: Record<SiteActivity, { label: string; className: string }> = {
  training: { label: 'Training', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  reported: { label: 'Reported', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  idle: { label: 'Idle', className: 'bg-gray-50 text-gray-600 border-gray-200' },
  unreachable: { label: 'Unreachable', className: 'bg-red-50 text-red-700 border-red-200' },
  pending_review: { label: 'Awaiting review', className: 'bg-amber-50 text-amber-800 border-amber-200' },
};

const ActivityPill: React.FC<{ activity: SiteActivity }> = ({ activity }) => {
  const style = ACTIVITY_STYLES[activity] ?? ACTIVITY_STYLES.idle;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      {activity === 'training' && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {style.label}
    </span>
  );
};

interface SiteRosterProps {
  sites: SiteRecord[];
  /** Shown as a "joined at round N" column when the campaign has a round counter. */
  showJoinedRound?: boolean;
}

const SiteRoster: React.FC<SiteRosterProps> = ({ sites, showJoinedRound = true }) => {
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
                    <Value label="Location not declared">{site.country}</Value>
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
                  <Value>{formatCount(site.n_train_images)}</Value>
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
      <p className="mt-3 text-xs text-gray-500">
        Site names are self-declared by each participating deployment. The platform does not verify
        that a deployment belongs to the institution it names, so this is a list of participants
        rather than an attested membership record.
      </p>
    </div>
  );
};

export default SiteRoster;
