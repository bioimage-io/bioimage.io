import React from 'react';
import { PayloadDescriptor, TransportSummary } from '../../types/campaign';
import { formatBytes, formatCount, formatRatio } from './format';
import MissingValue, { Value } from './MissingValue';

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
 * different kind of claim, so it renders separately and labelled.
 *
 * The asymmetry ratio is computed only from the OBSERVED side, and only when
 * both halves of it were measured. A ratio with a computed numerator or an
 * estimated denominator is not an audit.
 */

interface TransportAuditProps {
  transport: TransportSummary | null;
  payload: PayloadDescriptor | null;
  /** Compact variant for the model page, which has less room. */
  compact?: boolean;
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

const TransportAudit: React.FC<TransportAuditProps> = ({ transport, payload, compact }) => {
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

  const heldBytes = formatBytes(transport.images_held?.bytes);
  const heldImages = formatCount(transport.images_held?.n_images);
  const imagesMoved = formatBytes(transport.images_moved_bytes);

  // Observed numerator only. A ratio against the computed figure would read as
  // measured, and the computed figure is the half that is not.
  const ratio = formatRatio(transport.images_held?.bytes, observedOut);

  // Prefer the byte figure when the campaign measured one. When it did not,
  // fall back to the image count and say which it is, rather than estimating a
  // size from the count.
  const heldValue = heldBytes ?? (heldImages ? `${heldImages} images` : null);
  const heldHint = heldBytes
    ? heldImages
      ? `${heldImages} images across the roster`
      : undefined
    : 'This campaign records image counts, not sizes on disk';

  // The payload label is whatever the campaign reported. The page never
  // assumes an adapter: a small network exchanging its whole state dict is a
  // legitimate campaign and has to read correctly here too.
  const payloadLabel = payload?.label ?? null;
  const perRound = formatBytes(payload?.bytes_per_site_per_round);

  const kinds = transport.kinds_transferred;

  return (
    <div>
      <div className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        <Figure
          label="What travels"
          value={payloadLabel}
          hint={perRound ? `${perRound} per site, per round` : undefined}
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
          <span className="text-gray-500">Transport asymmetry: </span>
          {ratio ? (
            <span className="font-semibold text-gray-900">{ratio}</span>
          ) : (
            <MissingValue label="Not computable from what was measured" />
          )}
        </div>
        <div>
          <span className="text-gray-500">Transfers logged: </span>
          <span className="font-medium tabular-nums text-gray-800">
            <Value>{formatCount(observedTransfers)}</Value>
          </span>
        </div>
      </div>

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
            <span className="text-2xl font-semibold tabular-nums text-gray-900">
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
              : ' It has not been checked against a control run.'}
          </p>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
        {transport.only_weights_left_site === true && kinds && kinds.length > 0 ? (
          <p className="text-sm text-gray-800">
            <span className="font-semibold">Only model weights left each site.</span>{' '}
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
            The campaign service did not report whether only model weights left each site, so this
            page makes no claim either way.
          </p>
        )}
      </div>
    </div>
  );
};

export default TransportAudit;
