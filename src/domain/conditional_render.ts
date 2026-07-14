import type { BacklogBackend, SpecBackend, VersionScheme } from "./installed_lock.ts";
import {
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_SPEC_BACKENDS,
  KNOWN_VERSION_SCHEMES,
} from "./installed_lock.ts";

const BEGIN_RE = /^\s*<!--\s*BEGIN:\s*backend=([a-zA-Z0-9_-]+)\s*-->\s*$/;
const END_RE = /^\s*<!--\s*END:\s*backend=([a-zA-Z0-9_-]+)\s*-->\s*$/;
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
  const lines = source.split("\n");
  const out: string[] = [];
  let insideFence = false;
  let openBackend: string | null = null;
  let openLine = -1;
  let keepBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      insideFence = !insideFence;
      if (openBackend === null || keepBlock) out.push(line);
      continue;
    }

    if (!insideFence) {
      const beginMatch = line.match(BEGIN_RE);
      if (beginMatch) {
        if (openBackend !== null) {
          throw new Error(
            `nested backend marker at line ${i + 1}: BEGIN ${beginMatch[1]} ` +
              `inside open block ${openBackend} (started at line ${openLine + 1})`,
          );
        }
        openBackend = beginMatch[1];
        openLine = i;
        keepBlock = openBackend === active;
        continue;
      }

      const endMatch = line.match(END_RE);
      if (endMatch) {
        if (openBackend === null) {
          throw new Error(
            `unmatched END marker at line ${i + 1}: backend=${endMatch[1]}`,
          );
        }
        if (endMatch[1] !== openBackend) {
          throw new Error(
            `mismatched END marker at line ${i + 1}: expected backend=${openBackend} ` +
              `(opened at line ${openLine + 1}), got backend=${endMatch[1]}`,
          );
        }
        openBackend = null;
        keepBlock = false;
        continue;
      }
    }

    if (openBackend === null || keepBlock) out.push(line);
  }

  if (openBackend !== null) {
    throw new Error(
      `unmatched BEGIN marker at line ${openLine + 1}: backend=${openBackend}`,
    );
  }

  return out.join("\n");
}

/** Throws if `s` is not a known backlog backend. */
export function assertKnownBackend(s: string): asserts s is BacklogBackend {
  if (!KNOWN_BACKLOG_BACKENDS.includes(s as BacklogBackend)) {
    throw new Error(
      `unknown backlog backend '${s}' — known: ${KNOWN_BACKLOG_BACKENDS.join(", ")}`,
    );
  }
}

const SPEC_BEGIN_RE = /^\s*<!--\s*BEGIN:\s*spec-backend=([a-zA-Z0-9_-]+)\s*-->\s*$/;
const SPEC_END_RE = /^\s*<!--\s*END:\s*spec-backend=([a-zA-Z0-9_-]+)\s*-->\s*$/;

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
  const lines = source.split("\n");
  const out: string[] = [];
  let insideFence = false;
  let openBackend: string | null = null;
  let openLine = -1;
  let keepBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      insideFence = !insideFence;
      if (openBackend === null || keepBlock) out.push(line);
      continue;
    }

    if (!insideFence) {
      const beginMatch = line.match(SPEC_BEGIN_RE);
      if (beginMatch) {
        if (openBackend !== null) {
          throw new Error(
            `nested spec-backend marker at line ${i + 1}: BEGIN ${beginMatch[1]} ` +
              `inside open block ${openBackend} (started at line ${openLine + 1})`,
          );
        }
        openBackend = beginMatch[1];
        openLine = i;
        keepBlock = openBackend === active;
        continue;
      }

      const endMatch = line.match(SPEC_END_RE);
      if (endMatch) {
        if (openBackend === null) {
          throw new Error(
            `unmatched END marker at line ${i + 1}: spec-backend=${endMatch[1]}`,
          );
        }
        if (endMatch[1] !== openBackend) {
          throw new Error(
            `mismatched END marker at line ${i + 1}: expected spec-backend=${openBackend} ` +
              `(opened at line ${openLine + 1}), got spec-backend=${endMatch[1]}`,
          );
        }
        openBackend = null;
        keepBlock = false;
        continue;
      }
    }

    if (openBackend === null || keepBlock) out.push(line);
  }

  if (openBackend !== null) {
    throw new Error(
      `unmatched BEGIN marker at line ${openLine + 1}: spec-backend=${openBackend}`,
    );
  }

  return out.join("\n");
}

/** Throws if `s` is not a known spec backend. */
export function assertKnownSpecBackend(s: string): asserts s is SpecBackend {
  if (!KNOWN_SPEC_BACKENDS.includes(s as SpecBackend)) {
    throw new Error(
      `unknown spec backend '${s}' — known: ${KNOWN_SPEC_BACKENDS.join(", ")}`,
    );
  }
}

const SH_SCHEME_BEGIN_RE = /^\s*#\s*BEGIN:\s*scheme=([a-zA-Z0-9_-]+)\s*$/;
const SH_SCHEME_END_RE = /^\s*#\s*END:\s*scheme=([a-zA-Z0-9_-]+)\s*$/;

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
  const lines = source.split("\n");
  const out: string[] = [];
  let openScheme: string | null = null;
  let openLine = -1;
  let keepBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const beginMatch = line.match(SH_SCHEME_BEGIN_RE);
    if (beginMatch) {
      if (openScheme !== null) {
        throw new Error(
          `nested scheme marker at line ${i + 1}: BEGIN ${beginMatch[1]} ` +
            `inside open block ${openScheme} (started at line ${openLine + 1})`,
        );
      }
      openScheme = beginMatch[1];
      openLine = i;
      keepBlock = openScheme === active;
      continue;
    }

    const endMatch = line.match(SH_SCHEME_END_RE);
    if (endMatch) {
      if (openScheme === null) {
        throw new Error(
          `unmatched END marker at line ${i + 1}: scheme=${endMatch[1]}`,
        );
      }
      if (endMatch[1] !== openScheme) {
        throw new Error(
          `mismatched END marker at line ${i + 1}: expected scheme=${openScheme} ` +
            `(opened at line ${openLine + 1}), got scheme=${endMatch[1]}`,
        );
      }
      openScheme = null;
      keepBlock = false;
      continue;
    }

    if (openScheme === null || keepBlock) out.push(line);
  }

  if (openScheme !== null) {
    throw new Error(
      `unmatched BEGIN marker at line ${openLine + 1}: scheme=${openScheme}`,
    );
  }

  return out.join("\n");
}

/** Throws if `s` is not a known version scheme. */
export function assertKnownScheme(s: string): asserts s is VersionScheme {
  if (!KNOWN_VERSION_SCHEMES.includes(s as VersionScheme)) {
    throw new Error(
      `unknown version scheme '${s}' — known: ${KNOWN_VERSION_SCHEMES.join(", ")}`,
    );
  }
}
