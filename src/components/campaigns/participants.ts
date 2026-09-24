/**
 * What to call the people on the other end of a campaign.
 *
 * A campaign has CONTRIBUTORS. A contributor trains when it suits them and owes
 * nobody a schedule. There is no round to miss.
 *
 * THIS USED TO BE A CHOICE BETWEEN TWO WORDS. Through 0.13.0-draft the contract
 * also had a synchronous arm, whose participants were SITES: institutions that
 * signed up to a fixed run, held a fixed dataset, and were expected to report
 * every round, so that missing one was an event the page reported. That arm was
 * removed at 0.14.0-draft and 'site' went with it, because calling a contributor
 * a site imports an obligation the campaign never asked for.
 *
 * The second case is what keeps this a function rather than a constant. Some
 * components render outside a campaign screen, on a model page where the
 * campaign's mode is not in scope. Those get "participants", which is vaguer
 * and true regardless. That is also the seam a future second mode arrives
 * through: a mode this table does not know is not a contributor campaign, and
 * the vague noun is the one that stays true if it turns out not to be.
 */
export type ParticipantMode = 'asynchronous' | null;

export interface ParticipantNouns {
  /** "each contributor". */
  singular: string;
  /** "the participating contributors". */
  plural: string;
  /**
   * Possessive plural, with the typographic apostrophe the rest of the page
   * uses. Built here rather than by appending at each call site, because the
   * plural-possessive form is not always the plural plus an apostrophe and a
   * call site adding one by hand cannot know that.
   */
  possessivePlural: string;
}

const NOUNS: Record<'asynchronous' | 'unknown', ParticipantNouns> = {
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
