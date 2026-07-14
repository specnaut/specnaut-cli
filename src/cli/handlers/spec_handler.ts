// `specnaut spec <push|pull> <task>` (spec 020) — sync a task's spec with
// SpecNaut Cloud. `pull` materialises a cloud spec into the gitignored cache so
// downstream agents read plain files; `push` upserts local cache content back to
// the cloud. Both are cloud-backend-only: under the `local` backend they exit
// with a clear message (there is no remote spec to sync). Mirrors gate_handler.ts
// — deps built from readCloudConfig + defaultCredentialStore(), exit codes 0/1/5.
//
//   pull  exit 0 (materialised / no-spec) · 1 (usage / local backend) · 5 (cloud/auth)
//   push  exit 0 (upserted) · 1 (usage / local backend / nothing to push) · 5 (cloud/auth)
//
// Constitution § I: stdout/stderr carry only CLI-owned messages + public
// task/step data; a cloud failure is a status-derived reason, never a backend
// string or Cloud-internal identifier.

import { dim, green, red, yellow } from "@std/fmt/colors";
import { readCloudConfig } from "../../domain/cloud/cloud_config.ts";
import { defaultCredentialStore } from "../../infrastructure/credential_store.ts";
import { makeSpecSession, type SpecSession } from "../../domain/cloud/spec_session.ts";
import { SpecApiError } from "../../domain/cloud/spec_client.ts";
import { CloudSpecStore } from "../../infrastructure/spec/cloud_spec_store.ts";
import { SpecCacheWriter } from "../../infrastructure/spec/spec_cache_writer.ts";
import type { SpecCacheStore } from "../../application/ports.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import type { SpecBackend } from "../../domain/installed_lock.ts";
import type { SpecStep } from "../../domain/spec/spec_step.ts";

export type SpecIntent = {
  kind: "spec";
  sub: "push" | "pull";
  task: number | null;
  apiUrl: string | null;
};

/** Injectable IO/deps seam — defaults to real stdio/cwd/lock/cache; tests override. */
export type SpecDeps = {
  out: (s: string) => void;
  err: (s: string) => void;
  projectDir: string;
  /** The project's persisted spec backend (absent lock → "local"). */
  readSpecBackend: () => Promise<SpecBackend>;
  /** Build a cloud spec session, or null when not Cloud-linked. */
  buildSession: () => Promise<SpecSession | null>;
  cache: SpecCacheStore;
};

function defaultDeps(intent: SpecIntent): SpecDeps {
  const projectDir = Deno.cwd();
  return {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    projectDir,
    readSpecBackend: async () => {
      const lock = await new FsLockStore().read(projectDir);
      return lock?.specBackend ?? "local";
    },
    buildSession: async () => {
      const config = await readCloudConfig(projectDir);
      if (!config) return null;
      const apiUrl = intent.apiUrl ?? config.apiUrl;
      if (!apiUrl) return null;
      return makeSpecSession({
        config: { ...config, apiUrl },
        store: defaultCredentialStore(),
      });
    },
    cache: new SpecCacheWriter(),
  };
}

export async function runSpec(
  intent: SpecIntent,
  deps: SpecDeps = defaultDeps(intent),
): Promise<number> {
  if (intent.task === null) {
    deps.err(red(`error: \`specnaut spec ${intent.sub}\` requires a task number.`));
    return 1;
  }

  // Backend gate: spec push/pull are cloud-only verbs (contract § B). Under the
  // local backend there is no remote spec to sync — exit with a clear message.
  const backend = await deps.readSpecBackend();
  if (backend !== "cloud") {
    deps.err(
      red(
        "error: `spec push`/`spec pull` are cloud-backend commands — this project uses the " +
          "local spec backend (.specnaut/specs/). Nothing to sync.",
      ),
    );
    return 1;
  }

  return intent.sub === "pull"
    ? await runPull(intent.task, deps)
    : await runPush(intent.task, deps);
}

async function runPull(task: number, deps: SpecDeps): Promise<number> {
  const session = await deps.buildSession();
  if (!session) {
    deps.err(red("error: project is not Cloud-linked (run `specnaut cloud login`)."));
    return 5;
  }

  let steps: readonly SpecStep[] | null;
  try {
    steps = await new CloudSpecStore(session).pull(task);
  } catch (e) {
    // Offline / auth failure (FR-008): fall back to an existing cache if present,
    // otherwise a non-zero exit with an actionable message — never a partial or
    // silently-empty spec.
    const cached = await deps.cache.read(deps.projectDir, task);
    if (cached && cached.length > 0) {
      deps.err(
        yellow(
          `warning: could not reach Cloud (${
            reasonOf(e)
          }); reusing the existing cache for task ${task}.`,
        ),
      );
      deps.out(dim(`↳ ${cached.length} cached step(s) under .specnaut/specs/.cache/${task}/`));
      return 0;
    }
    deps.err(actionable(e, `pull spec for task ${task}`));
    return 5;
  }

  if (steps === null || steps.length === 0) {
    deps.out(yellow(`no spec for task ${task} on Cloud yet — nothing to materialise.`));
    return 0;
  }

  const written = await deps.cache.write(deps.projectDir, task, steps);
  deps.out(green(`✓ materialised ${written.length} step(s) for task ${task}:`));
  for (const p of written) deps.out(dim(`  ↳ ${p}`));
  return 0;
}

async function runPush(task: number, deps: SpecDeps): Promise<number> {
  const steps = await deps.cache.read(deps.projectDir, task);
  if (steps === null || steps.length === 0) {
    deps.err(
      red(
        `error: no cached spec content for task ${task} to push ` +
          `(run \`specnaut spec pull ${task}\` first, then edit the cached tabs).`,
      ),
    );
    return 1;
  }

  const session = await deps.buildSession();
  if (!session) {
    deps.err(red("error: project is not Cloud-linked (run `specnaut cloud login`)."));
    return 5;
  }

  try {
    await new CloudSpecStore(session).push(task, steps);
  } catch (e) {
    deps.err(actionable(e, `push spec for task ${task}`));
    return 5;
  }
  deps.out(green(`✓ pushed ${steps.length} step(s) for task ${task} to Cloud.`));
  return 0;
}

/** The typed status-reason of a cloud failure (never a backend string — § I). */
function reasonOf(e: unknown): string {
  return e instanceof SpecApiError ? e.reason : "unknown";
}

/** An actionable, § I-safe error message for a cloud failure. */
function actionable(e: unknown, what: string): string {
  const reason = reasonOf(e);
  if (reason === "unauthorized") {
    return red(`error: not authenticated to ${what} — run \`specnaut cloud login\` and retry.`);
  }
  return red(`error: could not ${what} (${reason}) — check your connection and retry.`);
}
