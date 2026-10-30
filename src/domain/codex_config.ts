/**
 * The `[agents]` defaults Specnaut writes into a project's `.codex/config.toml`.
 *
 * ## The reasoning default (cli#599, revised by cli#707)
 *
 * Codex resolves a spawned subagent's settings from three places, in order:
 * the explicit spawn value, then the `[agents]` default, then **the parent's
 * value**. A child spawned by task *description* rather than by `agent_type`
 * selects no Specnaut role, so the first link is empty; with no `[agents]`
 * default it would run at the primary session's reasoning budget. That is
 * invisible and it compounds: a session at the deepest budget hands it to
 * every untiered child it spawns.
 *
 * So the block sets a `medium` default for role-less children. It is a
 * default, not a cap: a bundled role sets its own budget in its
 * `.codex/agents/*.toml`, deeper where the seat needs it. No model is set —
 * every child, role or not, runs on the session's model, because Specnaut
 * names no model version (`codex_models.ts`); the reasoning effort is the
 * cost lever that does not go stale.
 *
 * ## The concurrency cap
 *
 * `max_concurrent_threads_per_session` bounds how many children the session
 * runs at once, so an orchestration cannot fan out without limit on the
 * user's account (`DEFAULT_MAX_CONCURRENT`).
 *
 * ## Every key here was read off Codex's own documentation
 *
 * `enabled`, `max_concurrent_threads_per_session`, `default_subagent_model`,
 * `default_subagent_reasoning_effort`, `interrupt_message`. An invented key in
 * a user's config file is a defect we would ship into their editor, so nothing
 * here is guessed. Three are written: the reasoning default for spawned
 * agents, the cap, and `enabled` (cli#681). `default_subagent_model` is not:
 * its value would be a model version. `enabled`
 * defaults to true in current Codex; writing it keeps the intent — Specnaut's
 * agents are meant to be used — visible, and survives a change of default.
 * `max_threads` is a legacy alias of the cap and is never written.
 */

/**
 * The reasoning effort a role-less child runs at: neither the deepest budget
 * nor the shallowest, since nothing says what the untiered work needs.
 * Codex accepts low|medium|high|xhigh|ultra|max.
 */
const DEFAULT_CHILD_EFFORT = "medium";

/**
 * Concurrency ceiling, excluding the primary.
 *
 * A cap rather than a throttle: the point is that an orchestration cannot fan
 * out without bound on the user's account, not that it should run serially.
 * Codex picks its own default when the key is unset, so this is Specnaut
 * choosing a conservative number the user can raise, not a value rescuing a
 * broken one.
 *
 * Exported because `/task review` caps its own seat fan-out at the same
 * number (`phases/review.md`, pinned by `review_fanout_test.ts`): one ceiling,
 * whichever harness runs the review.
 */
export const DEFAULT_MAX_CONCURRENT = 4;

/**
 * Every key the block writes, in the order it writes them — the one list the
 * refusal message names, so a key added to the block cannot be left out of the
 * advice given to a user whose own `[agents]` table refused it.
 */
export const CODEX_AGENTS_KEYS = [
  "enabled",
  "default_subagent_reasoning_effort",
  "max_concurrent_threads_per_session",
] as const;

/** The fence label. Stable — changing it orphans every already-written block. */
export const CODEX_CONFIG_BLOCK_LABEL = "codex agent defaults";

/**
 * The body of the managed block, without fences.
 *
 * Deliberately does NOT emit a top-level `model` key: that is the user's own
 * choice of primary model, and this block sets defaults for subagents, not for
 * the session itself.
 */
export function codexAgentDefaultsBlock(): string {
  return [
    "# Defaults for subagents Codex spawns WITHOUT an explicit role.",
    "#",
    `# Such a child runs on your session's model; this sets a ${DEFAULT_CHILD_EFFORT} default`,
    "# for its reasoning budget so untiered work does not run at the deepest one",
    "# by accident. Bundled Specnaut roles set their own in .codex/agents/*.toml.",
    "[agents]",
    "enabled = true",
    `default_subagent_reasoning_effort = "${DEFAULT_CHILD_EFFORT}"`,
    `max_concurrent_threads_per_session = ${DEFAULT_MAX_CONCURRENT}`,
  ].join("\n");
}

/**
 * Why a second `[agents]` table cannot simply be appended.
 *
 * TOML rejects a redefined table outright, so writing our block into a file
 * that already declares `[agents]` elsewhere would leave the user with a
 * config that does not parse — trading a silent default for a hard failure in
 * their editor. Refusing loudly is the accepted degradation, and the message
 * has to name the keys so the refusal is actionable rather than merely safe.
 */
export const CODEX_CONFIG_REFUSAL = {
  /**
   * An `[agents]` (or `[agents.x]`) header at the start of a line. Applied to
   * the host file with Specnaut's own block removed, so our own header never
   * triggers it.
   *
   * Consumers must compile this with the `m` flag — JavaScript has no inline
   * `(?m)`, and written that way the pattern would quietly match nothing,
   * which fails OPEN: the refusal never fires and the file is made
   * unparseable, the exact outcome it exists to prevent.
   */
  pattern: "^\\s*\\[agents(\\.|\\])",
  message: ".codex/config.toml already declares an [agents] table outside Specnaut's block — " +
    "left untouched, because a second [agents] header is a TOML redefinition error. " +
    "Add these to your own [agents] table — Specnaut writes them, and without the reasoning " +
    "default a role-less subagent runs at your session's budget: " +
    `${CODEX_AGENTS_KEYS.join(", ")}.`,
} as const;
