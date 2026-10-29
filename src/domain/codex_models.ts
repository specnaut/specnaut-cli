/**
 * Codex reasoning-effort mapping.
 *
 * Specnaut agents declare two frontmatter fields: `model:` — a capability
 * family borrowed from Claude's names (`opus`, `sonnet`, `haiku`) — and
 * `effort:` — a reasoning budget. Only the second crosses to Codex.
 *
 * **Specnaut names no model version** (Kevin, 2026-10-29; specnaut-cli#707).
 * Codex has no family aliases, only versioned ids, and an id written into a
 * scaffolded `.codex/agents/*.toml` is obsolete within weeks: it fails at
 * dispatch the day the account's catalogue drops it. So an emitted Codex
 * agent carries no `model` key and runs on the session's model; the budget it
 * needs still reaches it as `model_reasoning_effort`, and its model FAMILY —
 * never a version — is named in a comment, so the user knows which to pick.
 *
 * The two axes used to collapse the other way: the harness derived the effort
 * from the model tier and never read `effort:`, so when every bundled agent
 * moved to Opus all fifteen emitted `high` and the `xhigh` seats lost their
 * budget on Codex. Effort is read from `effort:` alone.
 */

/**
 * Claude family → Codex family (Kevin, 2026-10-29). Families only: a version
 * is never written, because it is obsolete within weeks.
 */
const CLAUDE_TO_CODEX_FAMILY: Readonly<Record<string, string>> = {
  haiku: "Luna",
  sonnet: "Terra",
  opus: "Sol",
  fable: "Astra",
};

/**
 * The Codex model family that matches an agent's `model:` family, or `null`
 * for an absent, `inherit` or unknown value. Names a family, never an id.
 */
export function codexFamilyOf(claudeFamily: string | null): string | null {
  return CLAUDE_TO_CODEX_FAMILY[claudeFamily?.trim().toLowerCase() ?? ""] ?? null;
}

/**
 * Reasoning efforts Codex accepts. Specnaut's own vocabulary
 * — {low, medium, high, xhigh} — is a strict subset, so the mapping is
 * identity; `ultra` and `max` are Codex-only and never emitted, because a
 * subagent is already the unit `ultra` fans out over.
 */
const CODEX_EFFORTS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
]);

/**
 * Resolves an agent's `effort:` to a Codex `model_reasoning_effort`.
 *
 * Identity over the shared vocabulary; `null` for anything else, so the
 * emitted TOML omits the key and the subagent inherits the session's setting —
 * a guess would fail on the user's machine, against a list we cannot see.
 */
export function effortToCodexReasoning(effort: string | null): string | null {
  const v = effort?.trim().toLowerCase() ?? "";
  return CODEX_EFFORTS.has(v) ? v : null;
}
