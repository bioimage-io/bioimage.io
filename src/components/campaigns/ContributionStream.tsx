import React, { useMemo } from 'react';
import {
  ContributionRecord,
  ContributorRecord,
  EmptyMerge,
  MergeTrigger,
  SoupRecord,
} from '../../types/campaign';
import { formatDate } from './format';

/**
 * The two streams of an asynchronous campaign, on one wall-clock axis.
 *
 * An async campaign is not one event stream, it is two, and drawing them as one
 * is what would make the page dishonest:
 *
 *   CONTRIBUTIONS are continuous and unordered. A contributor finishes a local
 *   fine-tune whenever their own hardware and their own week allow, pushes the
 *   weights, and starts again. Nothing synchronises them. Two land on the same
 *   afternoon and then nine days pass with none.
 *
 *   SOUP MERGES are discrete and ordered. Periodically the contributions that
 *   have arrived are assessed, the ones that improve the pool are averaged into
 *   a new community version, and that version is the thing everybody benefits
 *   from. Assessed is not the same set as taken, which is why a dot carries a
 *   disposition rather than just a date.
 *
 * So the x axis is TIME, not an index. Plotting either stream against its own
 * array index would space the events evenly, which is precisely the false
 * impression a reader carries over from synchronous federated learning: that
 * everyone marches in step. The gaps are the finding. Drawing the gaps as gaps
 * is most of the work this component does.
 *
 * The same reasoning forbids deriving a cadence from counts. Merge slots that
 * had nothing to fold publish no version, so elapsed time divided by version
 * count is not the merge interval and nothing here computes it.
 *
 * MERGE MARKERS COME FROM BOTH ARRAYS. Under greedy souping a merge can run and
 * admit nothing, and the backend records that with no soup and no version. If
 * this chart drew only `soups` it would show a stretch of grey dots with no merge
 * anywhere in it, under a legend saying those dots were assessed by a merge, and
 * a reader resolving that would attribute them to the next visible marker, which
 * is the wrong merge. So an empty merge gets a marker of its own kind. It is the
 * one place on the page where "a merge happened and published nothing" is
 * visible, and it needs to be visible here specifically, because this is the
 * only view that answers what happened and when.
 */

const VIEW_W = 720;
const PAD_L = 168;
const PAD_R = 20;
const PAD_T = 30;
const PAD_B = 34;
const LANE_H = 20;

const SOUP_COLOUR = '#7c3aed';
const DOT_COLOUR = '#2563eb';
/**
 * Assessed and not taken, and the colour choice is the whole argument.
 *
 * It is grey, not red, not amber, and not a cross. A greedy merge keeps a
 * checkpoint when adding it improves the pooled model and otherwise leaves it,
 * which is a fact about the pool at that moment and not a judgement on the
 * contributor: the same checkpoint offered against a later soup may well go in.
 * Any warning colour would state the opposite in the one channel a reader reads
 * before they read any caption.
 */
const SKIPPED_COLOUR = '#9ca3af';

type DotState = 'included' | 'pending' | 'excluded' | 'unknown';

function dotStateOf(disposition: ContributionRecord['disposition']): DotState {
  switch (disposition) {
    case 'included':
      return 'included';
    case 'pending':
      return 'pending';
    case 'excluded':
      return 'excluded';
    default:
      // Null on the wire. Not folded into 'included' as a default, because the
      // difference between "we know it went in" and "the campaign did not say"
      // is exactly what the fourth state exists to keep.
      return 'unknown';
  }
}

const DOT_STYLE: Record<DotState, { fill: string; stroke: string }> = {
  included: { fill: DOT_COLOUR, stroke: DOT_COLOUR },
  pending: { fill: '#ffffff', stroke: DOT_COLOUR },
  excluded: { fill: SKIPPED_COLOUR, stroke: SKIPPED_COLOUR },
  unknown: { fill: '#ffffff', stroke: SKIPPED_COLOUR },
};

const DOT_LABEL: Record<DotState, string> = {
  included: 'Contribution folded into a community version',
  pending: 'Received, waiting for the next merge',
  excluded: 'Assessed by a merge, not included in it',
  unknown: 'Reported without a merge outcome',
};

function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

interface Lane {
  contributorId: string;
  label: string;
  /** Null when the contributor is on the roster under a name only. */
  firstMs: number | null;
  points: Array<{ id: string; ms: number; state: DotState }>;
}

/** A merge on the axis, either kind. Discriminated so the marker can differ. */
type MergeMark =
  | { kind: 'published'; key: string; ms: number; label: string }
  | { kind: 'empty'; key: string; ms: number; label: string };

export interface ContributionStreamProps {
  contributions: ContributionRecord[];
  soups: SoupRecord[];
  /**
   * Merges that published nothing. Null means the service does not report them,
   * and the chart then stops claiming its merge markers are complete instead of
   * quietly showing a timeline with holes it cannot see.
   */
  emptyMerges: EmptyMerge[] | null;
  contributors: ContributorRecord[];
  mergeTrigger: MergeTrigger | null;
  /** Campaign start, used as the left edge when it precedes the first event. */
  startedAt: string | null;
}

const ContributionStream: React.FC<ContributionStreamProps> = ({
  contributions,
  soups,
  emptyMerges,
  contributors,
  mergeTrigger,
  startedAt,
}) => {
  const model = useMemo(() => {
    // A contribution from somebody who is not on the roster is COUNTED, not
    // dropped and not drawn under its raw id as though it were a name. Silently
    // discarding it would make the stream disagree with every count on the page
    // that comes from the same array.
    let offRoster = 0;
    let undated = 0;

    const lanes = new Map<string, Lane>();
    contributors.forEach((c) => {
      lanes.set(c.contributor_id, {
        contributorId: c.contributor_id,
        label: c.contributor_name,
        firstMs: msOf(c.joined_at),
        points: [],
      });
    });

    contributions.forEach((c) => {
      const ms = msOf(c.received_at);
      if (ms === null) {
        undated += 1;
        return;
      }
      const lane = lanes.get(c.contributor_id);
      if (!lane) {
        offRoster += 1;
        return;
      }
      lane.points.push({ id: c.contribution_id, ms, state: dotStateOf(c.disposition) });
      if (lane.firstMs === null || ms < lane.firstMs) lane.firstMs = ms;
    });

    // Only the states actually present get a legend entry. A legend that lists
    // "assessed, not included" for a campaign that has never skipped one tells a
    // reader something happened that did not.
    const statesPresent: DotState[] = (
      ['included', 'pending', 'excluded', 'unknown'] as DotState[]
    ).filter((s) => Array.from(lanes.values()).some((l) => l.points.some((p) => p.state === s)));

    // Both arrays, on one axis, sorted by time rather than concatenated. A
    // published merge and an empty one are the same kind of event in wall-clock
    // terms and only differ in what they produced, so they interleave.
    const published: MergeMark[] = soups
      .map((s) => ({
        kind: 'published' as const,
        key: s.soup_id,
        ms: msOf(s.merged_at),
        label: s.community_model?.version ?? '',
      }))
      .filter((m): m is MergeMark => m.ms !== null);

    const empty: MergeMark[] = (emptyMerges ?? [])
      .map((m, i) => ({
        kind: 'empty' as const,
        // No id on the wire, and none is needed: an empty merge is identified by
        // when it ran. Index breaks a tie if two land on the same instant.
        key: `empty-${m.merged_at}-${i}`,
        ms: msOf(m.merged_at),
        label: '',
      }))
      .filter((m): m is MergeMark => m.ms !== null);

    const merges = [...published, ...empty].sort((a, b) => a.ms - b.ms);
    const nEmpty = empty.length;

    // Only a scheduled trigger can name a next merge. Under 'manual' there is
    // nothing to predict, and under 'on_contributions' the date depends on when
    // volunteers finish runs on hardware nobody here controls, so a date drawn
    // on the axis would be this page's guess wearing the record's clothes.
    const nextMs =
      mergeTrigger?.kind === 'scheduled' ? msOf(mergeTrigger.next_merge_at) : null;

    const ordered = Array.from(lanes.values()).sort((a, b) => {
      if (a.firstMs === null && b.firstMs === null) return a.label.localeCompare(b.label);
      if (a.firstMs === null) return 1;
      if (b.firstMs === null) return -1;
      return a.firstMs - b.firstMs;
    });

    const eventTimes = [
      ...ordered.flatMap((l) => l.points.map((p) => p.ms)),
      ...merges.map((m) => m.ms),
    ];
    const startMs = msOf(startedAt);
    const lo = Math.min(...[...(startMs === null ? [] : [startMs]), ...eventTimes]);
    const hi = Math.max(...[...eventTimes, ...(nextMs === null ? [] : [nextMs])]);

    return {
      lanes: ordered,
      merges,
      nEmpty,
      // `== null` on purpose, so an OMITTED field lands here too. The schema
      // makes this required-and-nullable, but a producer that simply leaves it
      // out is exactly the case that must not silently read as "this campaign
      // has never run an empty merge".
      // eslint-disable-next-line eqeqeq
      mergesUnreported: emptyMerges == null,
      nextMs,
      lo,
      hi,
      offRoster,
      undated,
      statesPresent,
    };
  }, [contributions, soups, emptyMerges, contributors, mergeTrigger, startedAt]);

  const {
    lanes,
    merges,
    nEmpty,
    mergesUnreported,
    nextMs,
    lo,
    hi,
    offRoster,
    undated,
    statesPresent,
  } = model;

  if (lanes.length === 0 || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return (
      <p className="text-sm text-gray-500">
        No contributions have been recorded for this campaign yet.
      </p>
    );
  }

  const viewH = PAD_T + PAD_B + lanes.length * LANE_H;
  const span = hi - lo || 1;
  const x = (ms: number) => PAD_L + ((ms - lo) / span) * (VIEW_W - PAD_L - PAD_R);
  const laneY = (i: number) => PAD_T + i * LANE_H + LANE_H / 2;

  return (
    <div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        className="w-full"
        role="img"
        aria-label="Contributions over time, with the dates the community model was merged"
      >
        {/* Merge markers first, so contribution dots sit on top of them. */}
        {merges.map((m) => (
          // data-merge-kind so a test can assert that an empty merge is drawn
          // AND that it is drawn differently, which is the whole point of it
          // being here: a marker that looked like a version marker would say a
          // version was published.
          <g key={m.key} data-merge-kind={m.kind}>
            <line
              x1={x(m.ms)}
              x2={x(m.ms)}
              y1={PAD_T - 10}
              y2={viewH - PAD_B}
              stroke={m.kind === 'published' ? SOUP_COLOUR : SKIPPED_COLOUR}
              strokeWidth={1}
              strokeDasharray={m.kind === 'published' ? undefined : '2 3'}
              opacity={m.kind === 'published' ? 0.35 : 0.75}
            />
            {m.label !== '' && (
              <text
                x={x(m.ms)}
                y={PAD_T - 15}
                fontSize={9}
                fill={SOUP_COLOUR}
                textAnchor="middle"
              >
                {m.label}
              </text>
            )}
          </g>
        ))}

        {nextMs !== null && (
          <g>
            <line
              x1={x(nextMs)}
              x2={x(nextMs)}
              y1={PAD_T - 10}
              y2={viewH - PAD_B}
              stroke={SOUP_COLOUR}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.55}
            />
            <text
              x={x(nextMs)}
              y={PAD_T - 15}
              fontSize={9}
              fill={SOUP_COLOUR}
              textAnchor="end"
            >
              next
            </text>
          </g>
        )}

        {lanes.map((lane, i) => (
          <g key={lane.contributorId}>
            <line
              x1={PAD_L}
              x2={VIEW_W - PAD_R}
              y1={laneY(i)}
              y2={laneY(i)}
              stroke="#f3f4f6"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 10}
              y={laneY(i) + 3.5}
              fontSize={10}
              fill="#4b5563"
              textAnchor="end"
            >
              {lane.label.length > 28 ? `${lane.label.slice(0, 27)}…` : lane.label}
            </text>
            {lane.points.map((p) => (
              <circle
                key={p.id}
                cx={x(p.ms)}
                cy={laneY(i)}
                r={3.5}
                // Carried so a test can assert the colour of a state rather
                // than the colour of a class. The excluded dot being neutral
                // grey is a rule about what a reader sees before they read
                // anything, and the class name is not what they see.
                data-state={p.state}
                fill={DOT_STYLE[p.state].fill}
                stroke={DOT_STYLE[p.state].stroke}
                strokeWidth={1.5}
              />
            ))}
          </g>
        ))}

        <text x={PAD_L} y={viewH - 10} fontSize={11} fill="#6b7280">
          {formatDate(new Date(lo).toISOString())}
        </text>
        <text
          x={VIEW_W - PAD_R}
          y={viewH - 10}
          fontSize={11}
          fill="#6b7280"
          textAnchor="end"
        >
          {formatDate(new Date(hi).toISOString())}
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600">
        {statesPresent.map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full border-2"
              style={{
                backgroundColor: DOT_STYLE[s].fill,
                borderColor: DOT_STYLE[s].stroke,
              }}
            />
            {DOT_LABEL[s]}
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3 w-0.5"
            style={{ backgroundColor: SOUP_COLOUR }}
          />
          Merge that published a version
        </span>
        {/* Same rule as the dot legend: only listed when one is on the chart. */}
        {nEmpty > 0 && (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-3 w-0.5"
              style={{ backgroundColor: SKIPPED_COLOUR }}
            />
            Merge that published no new version
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        One row per contributor, placed on the date each contribution arrived. Nothing here is
        synchronised: contributors train on their own data at their own pace, and each merge
        considers whatever has arrived since the last one.
      </p>

      {/* The caption a reader needs BEFORE they form a theory about the grey
          dots, which is why it sits directly under the chart rather than in the
          lineage table further down. Two things it must not do: imply the
          contributor did something wrong, and imply the outcome is final. */}
      {statesPresent.includes('excluded') && (
        <p className="mt-2 text-xs text-gray-500">
          A merge adds contributions one at a time and keeps the ones that improve the community
          model. The rest are left out of that merge. This is a property of what the model already
          contained at the time, not a mark against the contribution or the data behind it, and a
          later merge may well take it.
        </p>
      )}

      {/* What a grey marker means, and it has to say BOTH cases without
          implying either is a fault. A merge that weighed contributions and kept
          none is the community model being good enough that nothing on offer
          improved it, which is a result and not an absence. */}
      {nEmpty > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {nEmpty === 1
            ? 'One merge published no new version. '
            : `${nEmpty} merges published no new version. `}
          That happens when nothing new had arrived, and it also happens when a merge weighed what
          had arrived and kept none of it, which means the community model was already at least as
          good as anything on offer. Either way the merge ran, so the gaps between versions are not
          all the same length.
        </p>
      )}

      {/* A merge slot that had nothing to fold publishes no version, so the
          spacing between markers is not the merge interval. Saying so is
          cheaper than having a reader measure the gap and infer a schedule.
          Redundant once the caption above is on screen, which names the same
          fact and points at markers the reader can see. */}
      {nEmpty === 0 && mergeTrigger?.kind === 'scheduled' && (
        <p className="mt-2 text-xs text-gray-500">
          Merges run on a schedule. A scheduled merge with no new contributions publishes nothing,
          so the gaps between versions are not all the same length.
        </p>
      )}

      {/* The chart cannot see what it was not sent. Without this, a campaign
          whose service omits empty merges is indistinguishable from one that has
          never run one, and the difference is the whole marker set. */}
      {mergesUnreported && (
        <p className="mt-2 text-xs text-gray-500">
          Only merges that published a version are marked. This campaign does not report merges that
          published nothing, so there may be merges between these markers that are not drawn.
        </p>
      )}

      {offRoster > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {offRoster === 1
            ? '1 contribution came from a contributor who is not on the roster below, so it has no row here.'
            : `${offRoster} contributions came from contributors who are not on the roster below, so they have no rows here.`}
        </p>
      )}
      {undated > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {undated === 1
            ? '1 contribution carries no readable arrival time and cannot be placed on this axis.'
            : `${undated} contributions carry no readable arrival time and cannot be placed on this axis.`}
        </p>
      )}
    </div>
  );
};

export default ContributionStream;
