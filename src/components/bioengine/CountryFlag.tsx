import React, { useState } from 'react';

/**
 * Small country flag for a worker's geo location.
 *
 * Source is flagcdn.com keyed by ISO 3166-1 alpha-2, the same approach the
 * chiron platform uses for its worker list, so the two sites render the same
 * worker the same way.
 *
 * Renders NOTHING without a country code. A flag is decoration next to a place
 * name that is already on screen, so a missing or broken one must leave the row
 * looking deliberate rather than leaving a broken-image glyph or a gap. That is
 * also why a load error hides the element instead of retrying: an unreachable
 * CDN is not worth a visible failure for an ornament.
 */
interface CountryFlagProps {
  countryCode?: string;
  countryName?: string;
  className?: string;
}

const CountryFlag: React.FC<CountryFlagProps> = ({ countryCode, countryName, className }) => {
  const [failed, setFailed] = useState(false);
  if (!countryCode || failed) return null;

  const code = countryCode.trim().toLowerCase();
  // Guard the URL rather than trusting the field: this value comes from a
  // worker's self-reported status, and anything that is not a two-letter code
  // would make a 404 request on every render.
  if (!/^[a-z]{2}$/.test(code)) return null;

  return (
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      // Decorative: the country name is already rendered beside it, so an
      // empty alt keeps a screen reader from announcing the place twice.
      alt=""
      aria-hidden="true"
      title={countryName || countryCode}
      onError={() => setFailed(true)}
      className={className || 'h-3 w-auto flex-shrink-0 rounded-[1px] ring-1 ring-black/10'}
    />
  );
};

export default CountryFlag;
