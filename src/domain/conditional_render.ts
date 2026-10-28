import type { BacklogBackend, SpecBackend, VersionScheme } from "./installed_lock.ts";
import {
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_SPEC_BACKENDS,
  KNOWN_VERSION_SCHEMES,
} from "./installed_lock.ts";

const FENCE_RE = /^\s*```/;

/**
 * Strip backend-conditional sections from a Markdown source.
 *
 * Markers are HTML comments on their own line:
 *   <!-- BEGIN: backend=local -->
 *   ...content kept when backend === "local"...
 *   <!-- END: backend=local -->
 *
 * For the `active` backend, the content is preserved and only the
 * surrounding marker lines are removed. For any other backend, the
 * markers AND the content between them are removed.
 *
 * Markers inside fenced code blocks are treated as plain content.
 *
 * Throws on unmatched markers (BEGIN without END, END without BEGIN)
 * and on nested markers.
 */
export function renderBackend(source: string, active: BacklogBackend): string {
  return renderMarked(source, "backend", active, "html");
}

/** Throws if `s` is not a known backlog backend. */
export function assertKnownBackend(s: string): asserts s is BacklogBackend {
  if (!KNOWN_BACKLOG_BACKENDS.includes(s as BacklogBackend)) {
    throw new Error(
      `unknown backlog backend '${s}' — known: ${KNOWN_BACKLOG_BACKENDS.join(", ")}`,
    );
  }
}

/**
 * Strip spec-backend-conditional sections from a Markdown source (spec 020).
 *
 * Markers are HTML comments on their own line, deliberately distinct from the
 * backlog `backend=` markers so the two never collide:
 *   <!-- BEGIN: spec-backend=local -->
 *   ...content kept when the spec backend === "local"...
 *   <!-- END: spec-backend=local -->
 *
 * For the `active` backend the content is preserved and only the surrounding
 * marker lines are removed; for any other backend the markers AND the content
 * between them are removed. Markers inside fenced code blocks are plain content.
 * A source with no `spec-backend=` markers passes through byte-for-byte — this is
 * what preserves FR-003 local parity for phase docs that were never marked up.
 *
 * Throws on unmatched (BEGIN without END, END without BEGIN) or nested markers.
 */
export function renderSpecBackend(source: string, active: SpecBackend): string {
  return renderMarked(source, "spec-backend", active, "html");
}

/** Throws if `s` is not a known spec backend. */
export function assertKnownSpecBackend(s: string): asserts s is SpecBackend {
  if (!KNOWN_SPEC_BACKENDS.includes(s as SpecBackend)) {
    throw new Error(
      `unknown spec backend '${s}' — known: ${KNOWN_SPEC_BACKENDS.join(", ")}`,
    );
  }
}

/**
 * Strip spec-autogen-conditional sections from a Markdown source (spec 021).
 *
 * A third marker family, deliberately distinct from `backend=` (backlog) and
 * `spec-backend=` (spec 020) so none of the three collide:
 *   <!-- BEGIN: spec-autogen=on -->
 *   ...guidance kept only when auto-generation is enabled...
 *   <!-- END: spec-autogen=on -->
 *
 * `enabled` maps to the active token `"on"` (true) / `"off"` (false): the block
 * whose token matches is preserved (markers stripped), the other is removed
 * entirely. This gates the opt-in auto-gen guidance (FR-005) — `enabled` is the
 * caller's `specAutogen && specBackend === "cloud"` decision, so `off` renders
 * are byte-identical to a doc that never carried the block. A source with no
 * `spec-autogen=` markers passes through unchanged.
 *
 * Throws on unmatched (BEGIN without END, END without BEGIN) or nested markers.
 */
export function renderSpecAutogen(source: string, enabled: boolean): string {
  return renderMarked(source, "spec-autogen", enabled ? "on" : "off", "html");
}

/**
 * Strip scheme-conditional sections from a shell source.
 *
 * Markers are shell comments on their own line:
 *   # BEGIN: scheme=date
 *   ...content kept when scheme === "date"...
 *   # END: scheme=date
 *
 * For the `active` scheme, the content is preserved and only the
 * surrounding marker lines are removed. For any other scheme, the
 * markers AND the content between them are removed.
 *
 * No fenced-code-block guard — shell sources don't have triple-backtick
 * fences that would confuse marker scanning.
 *
 * Throws on unmatched markers (BEGIN without END, END without BEGIN)
 * and on nested markers.
 */
export function renderScheme(source: string, active: VersionScheme): string {
  return renderMarked(source, "scheme", active, "shell");
}

/** Throws if `s` is not a known version scheme. */
export function assertKnownScheme(s: string): asserts s is VersionScheme {
  if (!KNOWN_VERSION_SCHEMES.includes(s as VersionScheme)) {
    throw new Error(
      `unknown version scheme '${s}' — known: ${KNOWN_VERSION_SCHEMES.join(", ")}`,
    );
  }
}

/**
 * The one marker renderer every family above calls: keep the block whose token
 * is `active` (markers stripped), drop the others with their markers.
 *
 * It was four copies of this loop — backend, spec-backend, spec-autogen,
 * scheme — byte-identical apart from the key, which is how a fix to one family
 * misses the other three. `html` markers are `<!-- BEGIN: key=X -->` and are
 * plain content inside a fenced code block; `shell` markers are
 * `# BEGIN: key=X`, and shell sources have no fences to guard.
 *
 * Throws on unmatched markers (BEGIN without END, END without BEGIN) and on
 * nested markers.
 */
export function renderMarked(
  source: string,
  key: string,
  active: string,
  syntax: "html" | "shell",
): string {
  const [open, close] = syntax === "html" ? ["<!--\\s*", "\\s*-->"] : ["#\\s*", ""];
  const begin = new RegExp(`^\\s*${open}BEGIN:\\s*${key}=([a-zA-Z0-9_-]+)${close}\\s*$`);
  const end = new RegExp(`^\\s*${open}END:\\s*${key}=([a-zA-Z0-9_-]+)${close}\\s*$`);
  const lines = source.split("\n");
  const out: string[] = [];
  let insideFence = false;
  let openToken: string | null = null;
  let openLine = -1;
  let keepBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (syntax === "html" && FENCE_RE.test(line)) {
      insideFence = !insideFence;
      if (openToken === null || keepBlock) out.push(line);
      continue;
    }

    if (!insideFence) {
      const beginMatch = line.match(begin);
      if (beginMatch) {
        if (openToken !== null) {
          throw new Error(
            `nested ${key} marker at line ${i + 1}: BEGIN ${beginMatch[1]} ` +
              `inside open block ${openToken} (started at line ${openLine + 1})`,
          );
        }
        openToken = beginMatch[1];
        openLine = i;
        keepBlock = openToken === active;
        continue;
      }

      const endMatch = line.match(end);
      if (endMatch) {
        if (openToken === null) {
          throw new Error(`unmatched END marker at line ${i + 1}: ${key}=${endMatch[1]}`);
        }
        if (endMatch[1] !== openToken) {
          throw new Error(
            `mismatched END marker at line ${i + 1}: expected ${key}=${openToken} ` +
              `(opened at line ${openLine + 1}), got ${key}=${endMatch[1]}`,
          );
        }
        openToken = null;
        keepBlock = false;
        continue;
      }
    }

    if (openToken === null || keepBlock) out.push(line);
  }

  if (openToken !== null) {
    throw new Error(`unmatched BEGIN marker at line ${openLine + 1}: ${key}=${openToken}`);
  }

  return out.join("\n");
}
