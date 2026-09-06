import React from 'react';
import { PayloadDescriptor, TransportSummary } from '../../types/campaign';
import { formatBytes, formatCount } from './format';
import MissingValue from './MissingValue';

/**
 * The headline: how many bytes have crossed the network, against how much data
 * never moved.
 *
 * This sits above everything else on both campaign screens because it is the
 * one live figure that no other federated-learning framework puts in front of a
 * reader. Round counters and rosters exist everywhere. A running byte total,
 * counted on the platform's own append-only log rather than asserted in a
 * README, is the claim this page is for, so it gets the position and the type
 * size rather than being the third panel down.
 *
 * The detailed audit still lives in <TransportAudit />. This is deliberately a
 * duplicate of two of its figures: the headline is what a visitor reads, the
 * audit is what a sceptic checks, and collapsing them into one would mean
 * either burying the number or dropping the caveats that make it checkable.
 *
 * It has to degrade without ever bluffing. Three states, in order:
 *
 *  1. The observed log covers the campaign, so the counted total is shown.
 *  2. The observed log is truncated but a campaign-wide figure was computed
 *     from the validated transfer pattern. That figure is shown as a LOWER
 *     BOUND, with both the bound and the label attached to the number itself
 *     rather than to a footnote below it.
 *  3. Neither exists, and the slot reads "not reported" with the reason.
 *
 * State 2 is not a compromise. The U-Net consortium campaign really did move
 * that data, and its per-source logs really did reset mid-run; refusing to show
 * anything would misreport a measurement problem as an absence of transport.
 * The pill sits inline with the number because that is the only place a reader
 * who reads nothing else will still see it.
 *
 * It is "at least" and not a total because the formula counts each arm once,
 * while a driver relaunch restarts the arm that was in flight from its first
 * round. Those rounds put weights on the network and the formula does not see
 * them. Nothing in the record says whether a campaign was restarted, and the
 * page does not need to know: "at least" is true either way, and it means both
 * of this widget's possible figures now fail in the same direction. Whichever
 * one is on screen, the real number is at least this large.
 *
 * There is no odometer animation. A count-up would render intermediate values
 * that were never true of this campaign, on the one widget whose entire value
 * is that every number on it is a real observation.
 *
 * The two figures sit side by side and are NEVER divided into one. The left one
 * grows with every round and the right one does not move at all, so a quotient
 * of them is a function of how long the campaign has been running, and for a
 * campaign that exchanges whole models it changes sign partway through. See the
 * note at the top of TransportAudit.tsx. The layout is a comparison and not a
 * verdict on purpose.
 */

interface TransportHeadlineProps {
  transport: TransportSummary | null;
  payload: PayloadDescriptor | null;
}

const TransportHeadline: React.FC<TransportHeadlineProps> = ({ transport, payload }) => {
  const observed = transport?.observed;
  const computed = transport?.computed;

  const observedValid = observed?.valid === true;
  const observedOut = observedValid ? observed?.driver?.bytes_out ?? null : null;

  // Prefer the counted total. Fall back to the computed one only when the log
  // cannot produce one, and carry the fact that it is computed alongside the
  // value so no branch below can render the number without it.
  const movedBytes = observedOut ?? (observedValid ? null : computed?.bytes_moved ?? null);
  const movedIsComputed = observedOut === null && movedBytes !== null;
  const moved = formatBytes(movedBytes);

  // The count is measured off push_weights(); the byte figure is one the sites
  // declared and there is no measured version of it anywhere in the driver.
  // They are different kinds of number, so the caption says which one landed
  // here rather than describing them both as "held".
  const heldBytes = formatBytes(transport?.declared_data_bytes);
  const heldImages = formatCount(transport?.images_held?.n_images);
  const held = heldBytes ?? (heldImages ? `${heldImages} images` : null);

  const perRound = formatBytes(payload?.bytes_per_site_per_round);
  const payloadLabel = payload?.label;

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-6 shadow-sm sm:p-7">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        What has crossed the network
      </h2>

      <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-6">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* The absent state is rendered at a normal size on purpose. A
                "Not reported" set in 4xl shouts louder than any figure on the
                page and turns a missing measurement into the loudest thing on
                the screen. */}
            {moved ? (
              <span className="text-4xl font-semibold tabular-nums tracking-tight text-gray-900">
                {/* The bound is part of the figure, set inside the same element
                    at the same baseline, so there is no way to read the number
                    without it and no way for a screenshot to crop it off. */}
                {movedIsComputed && (
                  <span className="mr-2 text-xl font-medium text-gray-500">at least</span>
                )}
                {moved}
              </span>
            ) : (
              <span className="text-xl">
                <MissingValue label="Not reported" />
              </span>
            )}
            {movedIsComputed && (
              <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-600">
                Computed, not observed
              </span>
            )}
          </div>
          {/* The caption stays neutral about what the payload IS. The label
              travels in the record and can be anything from "Full state dict"
              to "LoRA adapter (r=8, qkv and head)", so it goes in the sentence
              below where a capitalised noun phrase reads correctly, rather than
              being case-folded into a caption and mangled. */}
          <div className="mt-1.5 text-sm text-gray-600">left the participating sites</div>
        </div>

        <div className="hidden h-14 w-px self-center bg-gray-200 sm:block" aria-hidden="true" />

        <div>
          {held ? (
            <div className="text-4xl font-semibold tabular-nums tracking-tight text-gray-900">
              {held}
            </div>
          ) : (
            <div className="text-xl">
              <MissingValue label="Not reported" />
            </div>
          )}
          <div className="mt-1.5 text-sm text-gray-600">
            stayed where they were
            {heldBytes ? ', by the sites’ own account' : ''}
          </div>
        </div>
      </div>

      <p className="mt-5 max-w-3xl text-sm leading-relaxed text-gray-600">
        {observedValid ? (
          <>
            Counted on the campaign&rsquo;s own transport log as the campaign ran, not asserted
            afterwards.
            {payloadLabel
              ? ` What travels is ${payloadLabel}${perRound ? `, about ${perRound} per site per round` : ''}.`
              : ''}
          </>
        ) : movedIsComputed ? (
          <>
            The participants keep their transport logs in memory and start fresh ones when a
            process restarts, so the logs cover different stretches of this campaign and adding
            them up would undercount. This figure is worked out from the transfer pattern instead:{' '}
            {computed?.basis}. It is a floor and not a total, because a campaign that was
            restarted re-runs the stretch that was in flight and the formula counts that stretch
            once, so the real figure can only be larger.
          </>
        ) : (
          <>
            The campaign has not reported a transport total that covers the whole run, so none is
            shown here. Per-round figures below are unaffected wherever the log reaches them.
          </>
        )}
      </p>
    </section>
  );
};

export default TransportHeadline;
