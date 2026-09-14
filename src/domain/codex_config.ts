import { tierToCodexModel } from "./codex_models.ts";

/**
 * The `[agents]` defaults Specnaut writes into a project's `.codex/config.toml`.
 *
 * ## The gap this closes (cli#599)
 *
 * Codex resolves a spawned subagent's model from three places, in order: the
 * explicit spawn value, then the `[agents]` default, then **the parent's
 * value**. A child spawned by task *description* rather than by `agent_type`
 * selects no Specnaut role, so the first link is empty — and Specnaut emitted
 * no `[agents]` defaults anywhere, so the second was empty too. Every generic
 * child therefore inherited the primary session's model.
 *
 * That is invisible and it compounds: raising the primary model raises every
 * generic child with it, so a long orchestration can escalate onto the most
 * expensive model on the user's own account without anything saying so.
 *
 * ## Why the default is the all-rounder and not the deepest tier
 *
 * A child spawned without a role is, by definition, not one of the curated
 * seats — nobody chose a capability tier for it. Defaulting it to the deepest
 * model would make the silent-escalation path the *designed* path.
 *
 * This changes nothing for role-based dispatch: every bundled role TOML pins
 * its own `model`, and an explicit spawn value is the first link in the
 * resolution order, so it still wins. What it changes is the floor for work
 * nobody tiered.
 *
 * ## The model id is derived, never spelled here
 *
 * `codex_models.ts` says it is the only place to edit when OpenAI renames a
 * model. Writing the id into a template would make it the second, and the two
 * would drift on exactly the release that renamed it. So this builds the block
 * from `tierToCodexModel`, and `codex_config_test.ts` pins the relationship
 * rather than the string.
 *
 * ## Every key here was read off Codex's own documentation
 *
 * `enabled`, `max_concurrent_threads_per_session`, `default_subagent_model`,
 * `default_subagent_reasoning_effort`, `interrupt_message`. An invented key in
 * a user's config file is a defect we would ship into their editor, so nothing
 * here is guessed — and the two keys written are the two the documentation
 * describes as setting spawned-agent defaults.
 */

/** The capability tier a role-less child falls back to. */
const DEFAULT_CHILD_TIER = "sonnet";

/** Matching reasoning budget. Codex accepts low|medium|high|xhigh|ultra|max. */
const DEFAULT_CHILD_EFFORT = "medium";

/**
 * Concurrency ceiling, excluding the primary.
 *
 * A cap rather than a throttle: the point is that an orchestration cannot fan
 * out without bound on the user's account, not that it should run serially.
 * Codex picks its own default when the key is unset, so this is Specnaut
 * choosing a conservative number the user can raise, not a value rescuing a
 * broken one.
 */
const DEFAULT_MAX_CONCURRENT = 4;

/** The fence label. Stable — changing it orphans every already-written block. */
export const CODEX_CONFIG_BLOCK_LABEL = "codex agent defaults";

/**
 * The body of the managed block, without fences.
 *
 * Deliberately does NOT emit a top-level `model` key: that is the user's own
 * choice of primary model, and this file exists to stop a default leaking into
 * children, not to take that decision over.
 */
export function codexAgentDefaultsBlock(): string {
  const model = tierToCodexModel(DEFAULT_CHILD_TIER);
  if (model === null) {
    // Unreachable while `DEFAULT_CHILD_TIER` is a known tier, and a thrown
    // error beats emitting a TOML file with a missing value: a config that
    // half-declares a default is worse than one that declares none, because
    // the fall-through it produces is the very bug this closes.
    throw new Error(
      `codex_config: tier "${DEFAULT_CHILD_TIER}" has no Codex model — ` +
        `codex_models.ts and this file have diverged`,
    );
  }
  return [
    "# Defaults for subagents Codex spawns WITHOUT an explicit role.",
    "#",
    "# Codex resolves a child's model as: explicit spawn value → this default →",
    "# the parent session's value. Without these keys the last link is the only",
    "# one, so a child dispatched by task description silently inherits your",
    "# primary model — and raising your primary model raises every such child.",
    "#",
    "# Bundled Specnaut roles are unaffected: each pins its own model in",
    "# .codex/agents/*.toml, and an explicit spawn value still wins.",
    "[agents]",
    `default_subagent_model = "${model}"`,
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
    "Add these to your own [agents] table to stop role-less subagents inheriting your " +
    "primary model: default_subagent_model, default_subagent_reasoning_effort.",
} as const;
