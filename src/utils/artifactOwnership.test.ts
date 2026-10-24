import {
  getOwnership,
  identityKeywords,
  isContributorOnly,
  isMyArtifact,
  matchableName,
  ownedDisplayNames,
} from './artifactOwnership';

/**
 * Daniel Franco-Barranco's session as recorded on the issue: a Google login,
 * so no GitHub handle, and his author entries carry a null email. The display
 * name is the only field bridging session and manifest.
 */
const danielSession = {
  id: 'google-oauth2|109398169297807010606',
  email: 'danialtza@gmail.com',
  name: 'Daniel Franco-Barranco',
};

/** An artifact he authored but somebody else uploaded: 66 of his 76 look like this. */
const authoredBySomeoneElse = {
  id: 'bioimage-io/plucky-leopard',
  created_by: 'github|43643518',
  manifest: {
    name: 'A model',
    authors: [
      { name: 'Daniel Franco-Barranco', github_user: 'danifranco', email: null },
      { name: 'Ignacio Arganda-Carreras', github_user: 'iarganda' },
    ],
    uploader: { email: 'someone.else@example.org' },
  },
};

/** One he uploaded himself. */
const uploadedByDaniel = {
  id: 'bioimage-io/emotional-shrimp',
  created_by: 'github|43643518',
  manifest: {
    name: 'Another model',
    authors: [{ name: 'Someone Else' }],
    uploader: { email: 'Danialtza@Gmail.com' },
  },
};

describe('getOwnership', () => {
  it('matches an author by name when the entry has no email', () => {
    expect(getOwnership(authoredBySomeoneElse, danielSession)).toEqual({
      isOwner: false,
      isContributor: true,
    });
    expect(isContributorOnly(authoredBySomeoneElse, danielSession)).toBe(true);
  });

  it('matches the uploader by email, case-insensitively', () => {
    expect(getOwnership(uploadedByDaniel, danielSession)).toEqual({
      isOwner: true,
      isContributor: true,
    });
    expect(isContributorOnly(uploadedByDaniel, danielSession)).toBe(false);
  });

  it('matches created_by on the session id and on the parent id', () => {
    const artifact = { id: 'a', created_by: 'github|32868330', manifest: {} };
    expect(getOwnership(artifact, { id: 'github|32868330' }).isOwner).toBe(true);
    expect(
      getOwnership(artifact, { id: 'helix-mind-47125673', parent: 'github|32868330' }).isOwner,
    ).toBe(true);
    expect(getOwnership(artifact, { id: 'github|1' }).isOwner).toBe(false);
  });

  it('matches a maintainer', () => {
    const artifact = {
      id: 'a',
      manifest: { maintainers: [{ name: 'Daniel Franco-Barranco' }] },
    };
    expect(isMyArtifact(artifact, danielSession)).toBe(true);
  });

  it('matches an author by email when the manifest has one', () => {
    const artifact = {
      id: 'a',
      manifest: { authors: [{ name: 'D. F-B.', email: 'DANIALTZA@gmail.com' }] },
    };
    expect(isMyArtifact(artifact, danielSession)).toBe(true);
  });

  it('normalizes whitespace and case in names', () => {
    const artifact = {
      id: 'a',
      manifest: { authors: [{ name: '  daniel   franco-barranco ' }] },
    };
    expect(isMyArtifact(artifact, danielSession)).toBe(true);
  });

  it('does not match a different person', () => {
    expect(isMyArtifact(authoredBySomeoneElse, { name: 'Ada Lovelace' })).toBe(false);
    expect(isMyArtifact(authoredBySomeoneElse, { email: 'ada@example.org' })).toBe(false);
  });

  it('does not match a name that merely appears in the description', () => {
    const artifact = {
      id: 'a',
      created_by: 'github|1',
      manifest: {
        description: 'Reimplementation of the method by Daniel Franco-Barranco et al.',
        authors: [{ name: 'Someone Else' }],
      },
    };
    expect(isMyArtifact(artifact, danielSession)).toBe(false);
  });

  // The trap this issue exists to avoid. Daniel is one of 13 collection
  // reviewers, so the reviewer grant propagates to every model: a
  // permission-based rule returned 294 of 316 artifacts for him when measured
  // on 2026-10-24. Write access must never put a row on this page.
  it('does not match on permissions, even full ones', () => {
    const notHis = {
      id: 'bioimage-io/affable-shark',
      created_by: 'github|1',
      manifest: { name: 'Someone else model', authors: [{ name: 'Constantin Pape' }] },
      config: {
        permissions: {
          'google-oauth2|109398169297807010606': '*',
          'danialtza@gmail.com': 'rw+',
        },
      },
      _permissions: {
        'google-oauth2|109398169297807010606': ['read', 'edit', 'commit', 'delete'],
      },
    };
    expect(getOwnership(notHis, danielSession)).toEqual({
      isOwner: false,
      isContributor: false,
    });
    expect(isMyArtifact(notHis, danielSession)).toBe(false);
  });

  it('returns no match for a missing artifact or user', () => {
    expect(isMyArtifact(null, danielSession)).toBe(false);
    expect(isMyArtifact(authoredBySomeoneElse, null)).toBe(false);
    expect(isMyArtifact({ id: 'a' }, danielSession)).toBe(false);
  });

  it('tolerates malformed manifest entries', () => {
    const artifact = {
      id: 'a',
      manifest: { authors: ['a string', null, 42], maintainers: 'not a list', uploader: 'nope' },
    };
    expect(isMyArtifact(artifact, danielSession)).toBe(false);
  });
});

describe('matchableName', () => {
  it('rejects a name too short to be a useful key', () => {
    expect(matchableName({ name: 'Al' })).toBeNull();
    expect(matchableName({ name: '  ' })).toBeNull();
    expect(matchableName({})).toBeNull();
    expect(matchableName({ name: 'Ada' })).toBe('ada');
  });

  it('does not match an artifact on an unusable name', () => {
    const artifact = { id: 'a', manifest: { authors: [{ name: 'Al' }] } };
    expect(isMyArtifact(artifact, { name: 'Al' })).toBe(false);
  });
});

describe('ownedDisplayNames', () => {
  // Shaped like the live data measured 2026-10-24: of the 10 artifacts this
  // author uploaded, 3 carry `uploader.name` "Daniel Franco-Barranco", 2 carry
  // "Daniel Franco Barranco" and 5 carry no name at all.
  const ownUploads = [
    { id: 'a', manifest: { uploader: { email: 'danialtza@gmail.com', name: 'Daniel Franco-Barranco' } } },
    { id: 'b', manifest: { uploader: { email: 'danialtza@gmail.com', name: 'Daniel Franco Barranco' } } },
    { id: 'c', manifest: { uploader: { email: 'danialtza@gmail.com' } } },
  ];

  it('recovers every spelling the user signed their own uploads with', () => {
    expect(ownedDisplayNames(ownUploads, { email: 'danialtza@gmail.com' })).toEqual([
      'daniel franco-barranco',
      'daniel franco barranco',
    ]);
  });

  it('never takes a name from an artifact the user does not own', () => {
    const strangers = [
      { id: 'x', manifest: { uploader: { email: 'other@example.org', name: 'Ada Lovelace' } } },
    ];
    expect(ownedDisplayNames(strangers, { email: 'danialtza@gmail.com' })).toEqual([]);
    expect(ownedDisplayNames(null, danielSession)).toEqual([]);
  });

  // The point of the whole fallback: a session with no `name` (which is what
  // the two most recent sessions to comment on the live zoo looked like) still
  // matches its authored artifacts.
  it('lets a nameless session match authorship', () => {
    const nameless = { id: 'google-oauth2|x', email: 'danialtza@gmail.com' };
    expect(isMyArtifact(authoredBySomeoneElse, nameless)).toBe(false);
    const names = ownedDisplayNames(ownUploads, nameless);
    expect(isMyArtifact(authoredBySomeoneElse, nameless, names)).toBe(true);
    expect(isContributorOnly(authoredBySomeoneElse, nameless, names)).toBe(true);
  });

  it('matches the second spelling too', () => {
    const artifact = {
      id: 'a',
      manifest: { authors: [{ name: 'Daniel Franco Barranco' }] },
    };
    const names = ownedDisplayNames(ownUploads, { email: 'danialtza@gmail.com' });
    expect(isMyArtifact(artifact, { email: 'danialtza@gmail.com' }, names)).toBe(true);
  });
});

describe('identityKeywords', () => {
  it('offers one keyword per available signal', () => {
    expect(identityKeywords(danielSession)).toEqual([
      'danialtza@gmail.com',
      'daniel franco-barranco',
    ]);
  });

  it('degrades when a session carries no display name', () => {
    expect(identityKeywords({ id: 'github|1', email: 'a@b.c' })).toEqual(['a@b.c']);
    expect(identityKeywords({ id: 'github|1' })).toEqual([]);
    expect(identityKeywords(null)).toEqual([]);
  });
});
