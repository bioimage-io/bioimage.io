import { buildContributorPermissions, CONTRIBUTOR_PERMISSION_LEVEL } from './roles';

describe('buildContributorPermissions', () => {
  it('grants rw+ to a new author/maintainer matched by email', () => {
    const result = buildContributorPermissions(
      { authors: [{ email: 'author@example.com' }], maintainers: [{ email: 'maintainer@example.com' }] },
      {},
      undefined,
    );
    expect(result.permissions['author@example.com']).toBe(CONTRIBUTOR_PERMISSION_LEVEL);
    expect(result.permissions['maintainer@example.com']).toBe(CONTRIBUTOR_PERMISSION_LEVEL);
    expect(result.contributorKeys.sort()).toEqual(['author@example.com', 'maintainer@example.com']);
  });

  it('normalizes email casing/whitespace and skips entries without email', () => {
    const result = buildContributorPermissions(
      { authors: [{ email: '  Someone@Example.com  ' }, { name: 'no-email' } as any] },
      {},
      undefined,
    );
    expect(Object.keys(result.permissions)).toEqual(['someone@example.com']);
  });

  it('never downgrades an existing owner (*) or already-rw+ entry', () => {
    const result = buildContributorPermissions(
      { authors: [{ email: 'owner@example.com' }] },
      { 'owner@example.com': '*' },
      undefined,
    );
    expect(result.permissions['owner@example.com']).toBe('*');
  });

  it('revokes a dropped contributor whose entry is still exactly rw+', () => {
    const result = buildContributorPermissions(
      { authors: [] },
      { 'former@example.com': CONTRIBUTOR_PERMISSION_LEVEL },
      ['former@example.com'],
    );
    expect(result.permissions['former@example.com']).toBeUndefined();
    expect(result.contributorKeys).toEqual([]);
  });

  it('leaves a dropped contributor alone if the entry no longer matches what this sync granted', () => {
    const result = buildContributorPermissions(
      { authors: [] },
      { 'promoted@example.com': '*' },
      ['promoted@example.com'],
    );
    expect(result.permissions['promoted@example.com']).toBe('*');
    expect(result.contributorKeys).toEqual([]);
  });

  it('never touches permission entries unrelated to authors/maintainers', () => {
    const result = buildContributorPermissions(
      { authors: [{ email: 'author@example.com' }] },
      { 'github|105947657': 'rw+', 'uploader@example.com': '*' },
      [],
    );
    expect(result.permissions['github|105947657']).toBe('rw+');
    expect(result.permissions['uploader@example.com']).toBe('*');
    expect(result.permissions['author@example.com']).toBe(CONTRIBUTOR_PERMISSION_LEVEL);
  });

  it('grants to the first author only, not to a second author with an email', () => {
    const result = buildContributorPermissions(
      { authors: [{ email: 'first@example.com' }, { email: 'second@example.com' }] },
      {},
      undefined,
    );
    expect(result.permissions['first@example.com']).toBe(CONTRIBUTOR_PERMISSION_LEVEL);
    expect(result.permissions['second@example.com']).toBeUndefined();
    expect(result.contributorKeys).toEqual(['first@example.com']);
  });

  it('grants no author at all when the first author has no email, even if a later one does', () => {
    const result = buildContributorPermissions(
      { authors: [{ name: 'No Email' } as any, { email: 'second@example.com' }] },
      {},
      undefined,
    );
    expect(result.contributorKeys).toEqual([]);
    expect(Object.keys(result.permissions)).toEqual([]);
  });

  it('grants every maintainer, whatever their position in the list', () => {
    const result = buildContributorPermissions(
      {
        authors: [{ email: 'first@example.com' }, { email: 'second@example.com' }],
        maintainers: [{ email: 'm1@example.com' }, { email: 'm2@example.com' }],
      },
      {},
      undefined,
    );
    expect(result.contributorKeys.sort()).toEqual([
      'first@example.com',
      'm1@example.com',
      'm2@example.com',
    ]);
    expect(result.permissions['second@example.com']).toBeUndefined();
  });

  it('revokes a non-first author that an earlier, wider sync had granted', () => {
    const result = buildContributorPermissions(
      { authors: [{ email: 'first@example.com' }, { email: 'second@example.com' }] },
      {
        'first@example.com': CONTRIBUTOR_PERMISSION_LEVEL,
        'second@example.com': CONTRIBUTOR_PERMISSION_LEVEL,
      },
      ['first@example.com', 'second@example.com'],
    );
    expect(result.permissions['first@example.com']).toBe(CONTRIBUTOR_PERMISSION_LEVEL);
    expect(result.permissions['second@example.com']).toBeUndefined();
    expect(result.contributorKeys).toEqual(['first@example.com']);
  });

  it('does not revoke a non-first author whose entry is no longer this sync to own', () => {
    const result = buildContributorPermissions(
      { authors: [{ email: 'first@example.com' }, { email: 'second@example.com' }] },
      { 'second@example.com': '*' },
      ['second@example.com'],
    );
    expect(result.permissions['second@example.com']).toBe('*');
  });
});
