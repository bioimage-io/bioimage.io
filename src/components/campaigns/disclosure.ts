import { CampaignRecord } from '../../types/campaign';

/**
 * The disclosure gates, in one place.
 *
 * These encode rules set by the driver owner, not preferences. They live in a
 * module of their own so that "may this be shown" is answered once and read
 * everywhere, rather than each component re-deriving it from a status string
 * and drifting. A gate that is spelled out in four components is a gate that
 * will eventually be spelled differently in one of them.
 *
 * Every gate FAILS CLOSED. A null flag is treated exactly like false, because
 * the campaign service not saying whether something may be published is not
 * permission to publish it. That direction matters: the cost of withholding a
 * releasable figure is a missing panel, and the cost of the opposite is
 * publishing a number that was never cleared.
 */

/**
 * Whether accuracy may be shown at all.
 *
 * BINDING RULE: the live campaign page shows PROCESS only. Roster growth,
 * transport, round progress and fingerprints are live; accuracy is not, and
 * appears only after the campaign's primary-metric rules have resolved.
 *
 * The reason is that a metric published mid-run is read as a result when it is
 * a partial observation, and it is read as a comparison between sites when the
 * sites hold different data. Neither is recoverable by adding a caveat next to
 * it.
 *
 * `policy.outcomes_released` is the resolution signal and the service owns it.
 * The page does not second-guess it against `status`: a campaign whose rules
 * resolved early is the service's call to make, and a completed campaign that
 * has not resolved them yet must still withhold.
 */
export function outcomesReleased(record: CampaignRecord | null | undefined): boolean {
  return record?.policy?.outcomes_released === true;
}

/**
 * Whether the platform can attest that a roster entry is the institution it
 * names. False today under a shared-token deployment, which is why the roster
 * is presented as self-declared display names with no lock icons and no
 * "verified participant" wording anywhere.
 */
export function rosterAttested(record: CampaignRecord | null | undefined): boolean {
  return record?.policy?.roster_attested === true;
}
