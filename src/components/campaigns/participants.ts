/**
 * What to call the people on the other end of a campaign.
 *
 * The two modes do not have the same participants, and using one word for both
 * misdescribes whichever one it was not chosen for:
 *
 *   A SYNCHRONOUS consortium has SITES. A site is an institution that signed up
 *   to a fixed run, holds a fixed dataset, and is expected to report every
 *   round. Missing a round is an event the page reports.
 *
 *   An ASYNCHRONOUS campaign has CONTRIBUTORS. A contributor trains when it
 *   suits them and owes nobody a schedule. There is no round to miss, and
 *   calling them a site imports an obligation the campaign never asked for.
 *
 * The third case is the one that makes this a function rather than a constant.
 * Some components render outside a campaign screen, on a model page where the
 * campaign's mode is not in scope. Those get "participants", which is vaguer
 * than either and true of both. Guessing 'site' there because it is the older
 * word would put the wrong noun on every async model page, and it would be the
 * kind of wrong that nobody files a bug about.
 */
export type ParticipantMode = 'synchronous' | 'asynchronous' | null;

export interface ParticipantNouns {
  /** "each site", "each contributor". */
  singular: string;
  /** "the participating sites". */
  plural: string;
  /**
   * Possessive plural, with the typographic apostrophe the rest of the page
   * uses. Built here rather than by appending at each call site, because the
   * plural-possessive form is not always the plural plus an apostrophe and a
   * call site adding one by hand cannot know that.
   */
  possessivePlural: string;
}

const NOUNS: Record<'synchronous' | 'asynchronous' | 'unknown', ParticipantNouns> = {
  synchronous: {
    singular: 'site',
    plural: 'sites',
    possessivePlural: 'sites’',
  },
  asynchronous: {
    singular: 'contributor',
    plural: 'contributors',
    possessivePlural: 'contributors’',
  },
  unknown: {
    singular: 'participant',
    plural: 'participants',
    possessivePlural: 'participants’',
  },
};

export function participantNouns(mode: ParticipantMode): ParticipantNouns {
  return NOUNS[mode ?? 'unknown'];
}
