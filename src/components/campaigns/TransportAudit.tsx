import React from 'react';
import { PayloadDescriptor, TransportSummary } from '../../types/campaign';
import { formatBytes, formatCount, formatRatio } from './format';
import MissingValue, { Value } from './MissingValue';

/**
 * The transport audit: how many bytes of weights moved, against how much data
 * stayed where it was.
 *
 * Everything here comes from the platform's own append-only transport log. The
 * page states what was logged and computes nothing it was not given. In
 * particular the asymmetry ratio is rendered only when BOTH sides of it were
 * measured, because a ratio against an estimated denominator is not an audit.
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

  const movedOut = formatBytes(transport.bytes_out);
  const movedIn = formatBytes(transport.bytes_in);
  const heldBytes = formatBytes(transport.images_held.bytes);
  const heldImages = formatCount(transport.images_held.n_images);
  const imagesMoved = formatBytes(transport.images_moved_bytes);
  const ratio = formatRatio(transport.images_held.bytes, transport.bytes_out);

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
          value={movedOut}
          hint={movedIn ? `${movedIn} moved back in` : undefined}
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
            <MissingValue label="Not computable from what was reported" />
          )}
        </div>
        <div>
          <span className="text-gray-500">Transfers logged: </span>
          <span className="font-medium tabular-nums text-gray-800">
            <Value>{formatCount(transport.n_transfers)}</Value>
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
        {transport.only_weights_left_site === true && transport.kinds_transferred.length > 0 ? (
          <p className="text-sm text-gray-800">
            <span className="font-semibold">Only model weights left each site.</span>{' '}
            Every outbound transfer in the log is of kind{' '}
            {transport.kinds_transferred.join(', ')}. This is a check over the campaign's own
            transport log, not a statement of intent.
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
            Kinds seen: {transport.kinds_transferred.join(', ') || 'unknown'}.
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
