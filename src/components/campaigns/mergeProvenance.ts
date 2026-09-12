import { AgentInvocation, MergeTrigger } from '../../types/campaign';

/**
 * Whether the page may describe a campaign's merges as agent-driven.
 *
 * The thing being guarded against is a DECORATIVE AGENT: a scheduled loop
 * reported as an agent, drawn as an agent, and read by everyone as evidence
 * that the system does something it does not. That failure does not require
 * anyone to lie. It happens when a design grows an agent-shaped wrapper around
 * a cron and the vocabulary drifts to match.
 *
 * `MergeTrigger` was split so the page could TELL. `decided_by` says who makes
 * the call and `agent.invoked_by` says what called the agent, so the decorative
 * case is expressible, and therefore detectable, rather than unrepresentable
 * and therefore invisible. A schema that cannot state the dishonest case cannot
 * catch it either.
 *
 * Note the failure has a mirror image, and the two point in opposite
 * directions. An agent label over a timer is a DECORATIVE agent, and this
 * module refuses it. A deliberation claim over a nameable rule is an INFLATED
 * agent, and this module cannot see it at all, because that one lives in
 * `kind` and in the prose around it. Guarding one does nothing about the other,
 * which is worth knowing before anyone reads a green result here as clearance.
 *
 * TWO THINGS THIS MODULE DOES NOT DO, both worth knowing before a passing
 * result is read as verification.
 *
 * It does not verify that an agent ran anything. `decided_by` is a label set by
 * whoever configured the campaign, not an observation of who called: at least
 * one backend threads no caller identity through its merge entry point, and
 * threading one would not help, because a principal id is an identity rather
 * than an actor type. The check is real on the PAIR, where an agent reported
 * alongside a timer invocation is caught, and it is weak on `decided_by` alone.
 *
 * It also cannot tell a truthful record from a tidied one. `invoked_by` is
 * self-reported, so what is caught is the honest case, where a timer-invoked
 * agent is described accurately and the page declines to dress it up. That is
 * still the case worth catching, because a system drifting into decoration
 * without anyone intending it is far likelier than a service that decides to
 * write 'skill_call' over a cron.
 */

/**
 * Why the page declined to describe the merges as agent-run.
 *
 * Both members are refusals in the face of a record that SAYS 'agent', and they
 * are different enough that collapsing them would lose the useful half.
 *
 * 'invoked_by_timer' is the decorative case caught red-handed: the record is
 * internally honest, it states an agent invoked by a clock, and that is a loop
 * wearing a label. There is something here to report.
 *
 * 'invocation_unstated' is the record declining to say. That is NOT treated as
 * benign, and the reason is the same one that makes `aggregate_scope` default
 * to its strict branch: a check that can be disabled by omitting a field is not
 * a check. If a missing `agent` block bought the agent depiction anyway, the
 * cheapest way past this guard would be to send less, which is the opposite of
 * the incentive the guard is for.
 */
export type AgentRefusal = 'invoked_by_timer' | 'invocation_unstated';

/**
 * What the page believes about who runs the merges.
 *
 * `agent` is the only member that licenses describing the campaign as
 * agent-driven, and it is deliberately narrow: an agent the record says was
 * invoked through a skill call or by a person. Everything else either names a
 * different actor or refuses.
 */
export type MergeActor =
  | { kind: 'unstated' }
  | { kind: 'human' }
  | { kind: 'timer' }
  | { kind: 'agent'; invokedBy: Exclude<AgentInvocation, 'timer'> }
  | { kind: 'agent_refused'; refusal: AgentRefusal };

/**
 * Resolve the actor from the record, refusing where the record does not earn it.
 *
 * Pure and total, so the suite can drive it directly rather than only through
 * rendered text. That matters here for the same reason it mattered for the icon
 * guard: a check that can only run against rendered prose is blind to every
 * route that makes the claim some other way.
 */
export function resolveMergeActor(trigger: MergeTrigger | null): MergeActor {
  if (!trigger || trigger.decided_by === null) return { kind: 'unstated' };
  if (trigger.decided_by === 'human') return { kind: 'human' };
  if (trigger.decided_by === 'timer') return { kind: 'timer' };

  // decided_by === 'agent' from here. The claim still has to be qualified.
  const invokedBy = trigger.agent?.invoked_by ?? null;
  if (invokedBy === 'timer') return { kind: 'agent_refused', refusal: 'invoked_by_timer' };
  if (invokedBy === null) return { kind: 'agent_refused', refusal: 'invocation_unstated' };
  return { kind: 'agent', invokedBy };
}

/**
 * The sentence the page shows about who runs the merges, or null for silence.
 *
 * Null ONLY for 'unstated', where the caller already says the record does not
 * describe the trigger and a second sentence saying the same thing would be
 * noise. Every other member returns copy, including both refusals: a refusal
 * that renders nothing is indistinguishable from a record that said nothing,
 * which would hide exactly the case this module exists to surface.
 *
 * No icon accompanies any of this, and that is deliberate rather than
 * unfinished. An icon can make a claim that no text search will ever find, so
 * an agent glyph next to a refusal would defeat the refusal while every
 * text-based check stayed green.
 */
export function describeMergeActor(actor: MergeActor): string | null {
  switch (actor.kind) {
    case 'unstated':
      return null;
    case 'human':
      return 'Merges are run by the campaign stewards.';
    case 'timer':
      return 'Merges are fired automatically by a scheduled job.';
    case 'agent':
      return actor.invokedBy === 'skill_call'
        ? 'Merges are run by an agent acting through the campaign skill interface. It fires the merge, applies the gate that decides which contributions are kept, and publishes the result.'
        : 'Merges are run by an agent that a person starts. It fires the merge, applies the gate that decides which contributions are kept, and publishes the result.';
    case 'agent_refused':
      return actor.refusal === 'invoked_by_timer'
        ? 'This record describes the merges as agent-run, but also says the agent is started by a timer, so what it describes is a scheduled job. The page reports it as recorded rather than as agent-driven.'
        : 'This record describes the merges as agent-run but does not say what starts the agent, so the page does not report them as agent-driven.';
  }
}
