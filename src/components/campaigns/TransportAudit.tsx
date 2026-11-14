import React from 'react';
import { PayloadDescriptor, TransportSummary } from '../../types/campaign';
import { formatBytes, formatCount } from './format';
import { ParticipantMode, participantNouns } from './participants';
import { Value } from './MissingValue';

/**
 * The transport audit: how many bytes of weights moved, against how much data
 * stayed where it was.
 *
 * The panel is deliberately TWO blocks that are never merged into one number.
 *
 * `observed` is what the append-only transport log recorded. It renders only
 * when the per-source windows agree, because the per-source logs are in-memory
 * and reset on process restart: a driver relaunch or a site replica restart
 * leaves the sources on unsynchronised windows, and summing across them
 * produces a figure that looks complete and undercounts. That failure is
 * invisible in the total, which is exactly why it cannot be shown as one.
 *
 * `computed` is the campaign-wide figure derived from the validated transfer
 * pattern. It is trustworthy where the observed sum is not, but it is a
 * different kind of claim, so it renders separately and labelled, and it renders
 * as a lower bound: the formula counts each arm once, while a resumed run
 * re-runs the arm that was in flight and those first rounds really did move
 * weights. Both figures on this panel therefore fail in the same direction.
 * Neither can overstate what crossed the network.
 *
 * THERE IS NO ASYMMETRY RATIO ON THIS PANEL, and its absence is the considered
 * position rather than a gap waiting to be filled. Read this before adding one.
 *
 * The two quantities have different shapes. Bytes moved accumulates with every
 * merge; data held does not move at all. A quotient of the two is therefore not
 * one number, it is a number that depends entirely on the window you take it
 * over, and the windows disagree about the SIGN.
 *
 * Every campaign therefore has a crossover point, the moment at which the total
 * sent overtakes the total held, and the same run reads as a saving before it
 * and a cost after it. A per-merge figure sits permanently on the flattering
 * side of that crossing, so a per-merge ratio does not merely understate the
 * campaign-wide one. Past the crossing it reverses it, and nothing on a page
 * showing the per-merge number would tell a reader which side they were on.
 *
 * Where the crossing falls is set by the corpus size relative to the payload,
 * NOT by whether the payload is an adapter or a whole model. A 7.8 MB state
 * dict and a 1.2 GB one, moved on the same schedule over the same corpus, land
 * in completely different places, and both are full state dicts. The payload
 * KIND predicts nothing on its own.
 *
 * THE FORECAST CURVE IS NOT COMING BACK, and that is a narrowing worth
 * recording rather than leaving as an unexplained absence. Through 0.13.0-draft
 * this comment set out a cumulative-to-date curve with the crossing marked, and
 * `transportMath.ts` computed its per-step multiplier from each round's
 * `participants` and `eval_on` sets. That multiplier is a fact about LOCKSTEP
 * federated averaging, where every participant pushes, pulls and reads once per
 * round. An asynchronous campaign has no such step: a contributor pulls the
 * current community model when it feels like it and pushes one checkpoint back,
 * and merges happen on their own cadence. The module was deleted with the
 * synchronous arm at 0.14.0-draft because there was no expression left for it
 * to evaluate.
 *
 * What the async record carries instead is a MEASURED per-merge transport
 * figure, which is the better of the two anyway: it is a count rather than a
 * model of a count. The panel shows both quantities and no quotient. A reader
 * who wants the ratio can divide, and will have both labels in front of them
 * when they do.
 */

interface TransportAuditProps {
  transport: TransportSummary | null;
  payload: PayloadDescriptor | null;
  /** Compact variant for the model page, which has less room. */
  compact?: boolean;
  /** Chooses the noun for the people on the other end. See participants.ts. */
  mode?: ParticipantMode;
}

const Figure: React.FC<{
  label: string;
  value: string | null;
  hint?: string;
  emphasis?: boolean;
}> = ({ label, value, hint, emphasis }) => (
  <div className="rounded-xl border border-gray-200 bg-white/80 p-4 transition-shadow duration-200 hover:shadow-sm">
    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
    <div
      className={`mt-1 tabular-nums ${emphasis ? 'text-2xl font-semibold text-gray-900' : 'text-lg font-medium text-gray-800'}`}
    >
      <Value>{value}</Value>
    </div>
    {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
  </div>
);

const TransportAudit: React.FC<TransportAuditProps> = ({
  transport,
  payload,
  compact,
  mode = null,
}) => {
  const who = participantNouns(mode);
  // The unit the campaign advances in.
  //
  // A constant, and it used to be a ternary against `mode`: a synchronous run
  // advanced in ROUNDS and an asynchronous one in MERGES, and there is no word
  // that covers both without sounding like neither. Every mode the contract
  // still has advances in merges, so the branch was removed rather than left
  // with both arms returning the same string.
  //
  // It stays a named local so the sentence below reads it once instead of
  // spelling the noun out three times. A future mode that advances in something
  // else brings its branch back here, which is one line and one place.
  const step = 'merge';
  if (!transport) {
    return (
      <p className="text-sm text-gray-500">
        The campaign service reported no transport audit for this campaign.
      </p>
    );
  }

  const observed = transport.observed;
  const computed = transport.computed;

  // The observed totals exist only when the service says its windows agree.
  // Everything downstream of this reads null when they do not, which is the
  // point: an unusable measurement must be indistinguishable from an absent
  // one at every call site, not just at the one that renders the total.
  const observedValid = observed?.valid === true;
  const observedOut = observedValid ? observed?.driver?.bytes_out ?? null : null;
  const observedIn = observedValid ? observed?.driver?.bytes_in ?? null : null;
  const observedTransfers = observedValid ? observed?.driver?.n_transfers ?? null : null;

  const heldBytes = formatBytes(transport.declared_data_bytes);
  const heldImages = formatCount(transport.images_held?.n_images);
  const imagesMoved = formatBytes(transport.images_moved_bytes);

  // Prefer the byte figure when the campaign has one. When it does not, fall
  // back to the image count and say which it is, rather than estimating a size
  // from the count.
  //
  // The hint carries the standing of whichever figure landed here. The two are
  // not the same kind of number: the count is measured off push_weights(), the
  // byte figure is declared. This tile is the one place the declared
  // denominator appears on its own, so it has to say so here too and not only
  // in the ratio's footnote.
  const heldValue = heldBytes ?? (heldImages ? `${heldImages} images` : null);
  const heldHint = !heldBytes
    ? 'This campaign records image counts, not sizes on disk'
    : heldImages
      ? `${heldImages} images, and a size the ${who.plural} declared`
      : `Declared by the ${who.plural}, not measured by the platform`;

  // The payload label is whatever the campaign reported. The page never
  // assumes an adapter: a small network exchanging its whole state dict is a
  // legitimate campaign and has to read correctly here too.
  const payloadLabel = payload?.label ?? null;
  const perContribution = formatBytes(payload?.bytes_per_contribution);

  const kinds = transport.kinds_transferred;

  return (
    <div>
      <div className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        <Figure
          label="What travels"
          value={payloadLabel}
          hint={perContribution ? `${perContribution} per contribution` : undefined}
        />
        <Figure
          label="Weights moved out"
          value={formatBytes(observedOut)}
          hint={
            formatBytes(observedIn)
              ? `${formatBytes(observedIn)} moved back in`
              : observed && !observedValid
                ? 'The transport log is incomplete, see below'
                : undefined
          }
          emphasis
        />
        <Figure
          label="Image data moved"
          value={imagesMoved}
          hint="Measured on the transport log, not asserted"
          emphasis
        />
        <Figure
          label="Image data that stayed put"
          value={heldValue}
          hint={heldHint}
          emphasis
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-gray-500">Transfers logged: </span>
          <span className="font-medium tabular-nums text-gray-800">
            <Value>{formatCount(observedTransfers)}</Value>
          </span>
        </div>
      </div>

      {/* No quotient of the two headline figures is shown, for the reason set
          out at the top of this file. The note says so, because a reader who
          notices the obvious comparison is missing deserves to know it was
          left out on purpose rather than forgotten. */}
      {/* The unit comes from `step` rather than being written into the
          sentence, because the crossover argument is identical whatever a
          campaign advances in and only the noun would ever change. */}
      <p className="mt-2 text-xs leading-relaxed text-gray-500">
        This panel does not divide one of these figures by the other. The amount moved grows with
        every {step} while the amount held stays where it is, so any such comparison depends on the
        stretch of the campaign it is taken over, and for a campaign that exchanges whole models it
        can point either way. The useful version of that comparison is the {step} at which the
        total sent overtakes the total held, and it needs per-{step} coverage from the first{' '}
        {step} onwards.
      </p>

      {observed && !observedValid && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">The transport log is incomplete, so no total is
            shown.</span>{' '}
            Each participant keeps its own log in memory and starts a new one when its process
            restarts, so the logs cover different stretches of the campaign and cannot be added
            together. A total would look complete and would undercount.
            {observed.invalid_reason ? ` ${observed.invalid_reason}` : ''}
          </p>
          {observed.windows && observed.windows.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-900/90">
              {observed.windows.map((window) => (
                <li key={window.source} className="tabular-nums">
                  <span className="font-medium">{window.source}</span>: covers{' '}
                  <Value>{formatCount(window.n_transfers)}</Value> transfers
                  {window.first_seq !== null && window.last_seq !== null
                    ? ` (entries ${formatCount(window.first_seq)} to ${formatCount(window.last_seq)})`
                    : ''}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-amber-900/80">
            Per-round figures are unaffected where the log covers the round, because each entry
            carries the round it belongs to. A round the log does not cover reads as not reported.
          </p>
        </div>
      )}

      {computed && computed.bytes_moved !== null && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white/70 p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* "at least" sits inside the figure, at the figure's own baseline,
                so the qualifier cannot be read separately from the number it
                qualifies or dropped when someone quotes it. */}
            <span className="text-2xl font-semibold tabular-nums text-gray-900">
              <span className="mr-1.5 text-base font-medium text-gray-500">at least</span>
              <Value>{formatBytes(computed.bytes_moved)}</Value>
            </span>
            <span className="rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
              Computed, not observed
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Worked out from the campaign's transfer pattern rather than counted in the log:{' '}
            {computed.basis}.
            {computed.validated_against
              ? ` Checked against ${computed.validated_against}.`
              : ' It has not been checked against a control run.'}{' '}
            It counts the transfers the protocol requires, which is exact. It reads as a lower
            bound here because the question this page asks is what this campaign moved, and a
            campaign that was restarted re-runs the stretch that was in flight while the formula
            counts that stretch once.
          </p>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
        {transport.only_weights_left_site === true && kinds && kinds.length > 0 ? (
          <p className="text-sm text-gray-800">
            <span className="font-semibold">Only model weights left each {who.singular}.</span>{' '}
            Every outbound transfer in the log is of kind {kinds.join(', ')}. This is a check over
            the campaign's own transport log, not a statement of intent, and it holds even where
            the totals do not: an incomplete log cannot invent a transfer that is not in it.
          </p>
        ) : transport.only_weights_left_site === true ? (
          // A true verdict over an empty log is vacuous, so say what it rests on
          // rather than presenting it as a finding.
          <p className="text-sm text-gray-600">
            No outbound transfers have been logged yet, so there is nothing for this check to have
            found.
          </p>
        ) : transport.only_weights_left_site === false ? (
          <p className="text-sm text-red-800">
            <span className="font-semibold">The transport log records outbound transfers that
            are not model weights.</span>{' '}
            Kinds seen: {kinds && kinds.length > 0 ? kinds.join(', ') : 'unknown'}.
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            The campaign service did not report whether only model weights left each {who.singular}, so this
            page makes no claim either way.
          </p>
        )}
      </div>
    </div>
  );
};

export default TransportAudit;
