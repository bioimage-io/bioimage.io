import {
  mintZenodoVersion,
  resolveMintTarget,
  isRealZenodo,
  SANDBOX_ZENODO,
  REAL_ZENODO,
} from './zenodoMint';

// svamp #0062. Every model-change commit should mint a Zenodo version. The
// property that matters most here is NOT that minting works, it is that minting
// against REAL Zenodo cannot happen by accident: a DOI is permanent and cannot
// be un-minted, so a config flip must not silently turn every save into a
// citable public record.

const managerThatSucceeds = () => {
  const publish = jest.fn().mockResolvedValue({ doi: '10.5072/zenodo.1' });
  return { manager: { publish }, publish };
};

describe('target resolution', () => {
  it('reads publish_to', () => {
    expect(resolveMintTarget({ publish_to: SANDBOX_ZENODO })).toBe(SANDBOX_ZENODO);
  });

  it('treats a missing or null publish_to as no target', () => {
    expect(resolveMintTarget({})).toBeNull();
    expect(resolveMintTarget({ publish_to: null })).toBeNull();
    expect(resolveMintTarget(undefined)).toBeNull();
  });

  // An allow-list of one, so a typo is neither "production" nor "sandbox".
  it('only recognises the exact production target', () => {
    expect(isRealZenodo(REAL_ZENODO)).toBe(true);
    expect(isRealZenodo(SANDBOX_ZENODO)).toBe(false);
    expect(isRealZenodo('Zenodo')).toBe(false);
    expect(isRealZenodo('zenodo-prod')).toBe(false);
    expect(isRealZenodo(null)).toBe(false);
  });
});

describe('minting', () => {
  it('mints against sandbox, which is the live collection config', async () => {
    const { manager, publish } = managerThatSucceeds();
    const out = await mintZenodoVersion({
      artifactManager: manager, artifactId: 'bioimage-io/affable-shark',
      config: { publish_to: SANDBOX_ZENODO },
    });
    expect(out).toEqual({ status: 'minted', target: SANDBOX_ZENODO });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ artifact_id: 'bioimage-io/affable-shark', to: SANDBOX_ZENODO }),
    );
  });

  // THE IMPORTANT ONE. A DOI is permanent; this must never fire by default.
  it('REFUSES real Zenodo without an explicit opt-in, and does not call publish', async () => {
    const { manager, publish } = managerThatSucceeds();
    const out = await mintZenodoVersion({
      artifactManager: manager, artifactId: 'bioimage-io/affable-shark',
      config: { publish_to: REAL_ZENODO },
    });
    expect(out).toEqual({
      status: 'refused', reason: 'real-zenodo-not-opted-in', target: REAL_ZENODO,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  // Positive control for the guard: without this, a guard that refused
  // everything would pass the test above and look correct.
  it('mints real Zenodo when the opt-in IS passed', async () => {
    const { manager, publish } = managerThatSucceeds();
    const out = await mintZenodoVersion({
      artifactManager: manager, artifactId: 'bioimage-io/affable-shark',
      config: { publish_to: REAL_ZENODO }, allowRealZenodo: true,
    });
    expect(out).toEqual({ status: 'minted', target: REAL_ZENODO });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the artifact declares no target', async () => {
    const { manager, publish } = managerThatSucceeds();
    const out = await mintZenodoVersion({
      artifactManager: manager, artifactId: 'x', config: {},
    });
    expect(out).toEqual({ status: 'skipped', reason: 'no-target' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not mint to an unrecognised target', async () => {
    const { manager, publish } = managerThatSucceeds();
    const out = await mintZenodoVersion({
      artifactManager: manager, artifactId: 'x', config: { publish_to: 'figshare' },
    });
    expect(out).toEqual({ status: 'skipped', reason: 'unknown-target', target: 'figshare' });
    expect(publish).not.toHaveBeenCalled();
  });

  // The commit has already succeeded by the time this runs, so a minting failure
  // must be reported rather than thrown: nothing is rolled back either way.
  it('reports a publish failure instead of throwing', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('zenodo 503'));
    const out = await mintZenodoVersion({
      artifactManager: { publish }, artifactId: 'x',
      config: { publish_to: SANDBOX_ZENODO },
    });
    expect(out.status).toBe('failed');
    expect((out as any).error).toBeInstanceOf(Error);
  });

  it('survives a missing artifact manager', async () => {
    const out = await mintZenodoVersion({
      artifactManager: null, artifactId: 'x', config: { publish_to: SANDBOX_ZENODO },
    });
    expect(out.status).toBe('skipped');
  });
});
