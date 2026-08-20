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
});
