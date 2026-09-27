import type { BundleOptions } from "../../application/ports.ts";
import type { Bundle, TemplateFile } from "../../domain/template.ts";
import { renderBackend } from "../../domain/conditional_render.ts";

/** Destinations whose format carries HTML comments, and so can carry a marker. */
const MARKDOWN = /\.(md|mdc)$/;

/**
 * Layers a harness's static files on top of its mapped core bundle — the one
 * place every adapter does so (#612).
 *
 * Static Markdown renders its `backend=` markers against the active backlog
 * backend, exactly as a `backlog-skill` does. A harness context file is read on
 * every turn, and until now it was copied verbatim: the only way to mention a
 * backend-specific artefact was to mention it to all four backends, which is
 * how `.claude/CLAUDE.md` came to send a GitHub-backed project to a local
 * Markdown index it never received.
 *
 * Non-Markdown statics (hooks, scripts, JSON merge targets) pass through
 * untouched: an HTML-comment marker is not syntax there, only content.
 *
 * Statics may still sit on top of a core destination — that override rule is
 * unchanged, and deliberately not folded into `addUnique`.
 */
export function applyHarnessStatic(
  out: Bundle,
  statics: Readonly<Record<string, TemplateFile>>,
  opts: BundleOptions,
): void {
  for (const [dest, file] of Object.entries(statics)) {
    out[dest] = MARKDOWN.test(dest)
      ? { ...file, content: renderBackend(file.content, opts.backlogBackend) }
      : file;
  }
}
