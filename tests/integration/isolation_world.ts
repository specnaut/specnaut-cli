import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import { type ExecDeps, execInSandbox } from "../../src/application/sandbox_exec.ts";
import type { BranchExport } from "../../src/application/untrusted_review.ts";
import type { BackendProbe, SandboxedBackend } from "../../src/domain/sandbox.ts";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { runnerFor } from "../../src/infrastructure/sandbox_runners.ts";
import { exportHead, hostOf, type World } from "../helpers/export_world.ts";
import { initRepo, tempDir } from "../helpers/git_fixture.ts";
import {
  capture,
  LIVE_IMAGE,
  probed,
  RUNNER_HOST,
} from "../infrastructure/sandbox_live_fixture.ts";
import { type BranchText, probingBranch } from "./isolation_branch.ts";
import { type Forge, openForge } from "./isolation_forge.ts";

/**
 * One branch exported through the real export, then run through the real `execInSandbox` on one
 * backend, with secrets planted where a run must never reach them: a token file and a `hosts.yml`
 * in the home the sandbox is given, an `.env` in the checkout, a token in our own environment,
 * and a stand-in for the forge listening on the host. Only the fetch is the fixture's own
 * (`export_world.ts`); the home is a folder of the test's, so no real secret is ever read.
 */

/** The world the branch is exported in: its project is the repository itself. */
export type Isolation = World & {
  readonly home: string;
  readonly nonce: string;
  /** The planted secret, in every planted file and in our environment. */
  readonly secret: string;
  readonly planted: { readonly token: string; readonly hosts: string; readonly dotenv: string };
  readonly exported: BranchExport;
  readonly forge: Forge;
  readonly canary: string;
  readonly control: string;
};

const SECRET_VARS = ["GH_TOKEN", "GITHUB_TOKEN"];
/** `<what>-<16 random hex digits>`: a value no other run, and no fixture, can hold. */
const fresh = (what: string) => `${what}-${encodeHex(crypto.getRandomValues(new Uint8Array(8)))}`;

export async function withIsolation(
  fn: (iso: Isolation) => Promise<void>,
  lookup?: Uint8Array,
): Promise<void> {
  const base = await tempDir("specnaut-isolation-");
  const secret = fresh("secret");
  const before = SECRET_VARS.map((name) => [name, Deno.env.get(name)] as const);
  for (const name of SECRET_VARS) Deno.env.set(name, secret);
  try {
    const forge = await openForge();
    try {
      await exported(base, secret, lookup, (iso) => fn({ ...iso, forge }));
    } finally {
      await forge.close();
    }
  } finally {
    for (const [k, v] of before) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    await Deno.remove(base, { recursive: true });
  }
}

/** The secrets planted under `base`, and the branch exported, for as long as `fn` runs. */
async function exported(
  base: string,
  secret: string,
  lookup: Uint8Array | undefined,
  fn: (iso: Omit<Isolation, "forge">) => Promise<void>,
): Promise<void> {
  const [repo, cache, home] = ["repo", "cache", "home"].map((d) => join(base, d));
  for (const d of [repo, join(home, ".config", "gh")]) await Deno.mkdir(d, { recursive: true });
  await initRepo(repo);
  const planted = await plant(repo, home, secret);
  const text = { nonce: fresh("nonce"), canary: fresh("canary"), control: fresh("plain") };
  const w = { repo, project: repo, cache };
  const branch = await exportBranch(w, { ...text, linkTarget: planted.token, lookup });
  try {
    await fn({ ...w, home, secret, planted, exported: branch, ...text });
  } finally {
    await branch.remove();
  }
}

/** The branch built in `w`'s repository, exported into its cache by the real export. */
async function exportBranch(w: World, text: BranchText) {
  return await exportHead(w, await probingBranch(w.repo, text));
}

async function plant(repo: string, home: string, secret: string) {
  const planted = {
    token: join(home, "token"),
    hosts: join(home, ".config", "gh", "hosts.yml"),
    dotenv: join(repo, ".env"),
  };
  await Deno.writeTextFile(planted.token, `${secret}\n`);
  await Deno.writeTextFile(planted.hosts, `github.com:\n    oauth_token: ${secret}\n`);
  await Deno.writeTextFile(planted.dotenv, `TOKEN=${secret}\n`);
  return planted;
}

/** What this host offers, with every backend but `kind` taken away: the run is on that one. */
function only(kind: SandboxedBackend): BackendProbe {
  const none = { image: { kind: "none", why: "not this test's backend" } } as const;
  const off = { podman: "absent", docker: false } as const;
  if (kind === "container") {
    return {
      ...probed,
      image: { kind: "pinned", ref: LIVE_IMAGE },
      bwrap: "absent",
      sandboxExec: false,
    };
  }
  if (kind === "bwrap") return { ...probed, ...none, ...off, sandboxExec: false };
  return { ...probed, ...none, ...off, bwrap: "absent" };
}

/** `command` run on the export, on `kind`, as `specnaut sandbox exec` runs it. */
export async function sandboxed(kind: SandboxedBackend, iso: Isolation, command: string[]) {
  const out = capture();
  const err = capture();
  const deps: ExecDeps = {
    prober: { probe: () => Promise.resolve(only(kind)) },
    host: hostOf(iso, iso.home),
    runnerFor: (b) => runnerFor(b, new DenoProcessLauncher(out.stream, err.stream), RUNNER_HOST),
  };
  const outcome = await execInSandbox(deps, { sha: iso.exported.sha, toolchain: [], command });
  assert(outcome.kind === "ran", `nothing ran: ${JSON.stringify(outcome)}`);
  assertEquals(outcome.backend, kind);
  return { outcome: outcome.outcome, out: out.text(), err: err.text() };
}

/** The probe's results, by `<kind> <target>`; it must have started, or it proved nothing. */
export function results(out: string): Map<string, string> {
  const lines = out.trim().split("\n");
  assertEquals(lines[0], "probe started", `the probe never ran: ${out.slice(0, 300)}`);
  const found = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const [kind, target, ...rest] = line.split(" ");
    found.set(`${kind} ${target}`, rest.join(" ").trim());
  }
  return found;
}

/** The reason the system gives a call the sandbox refuses. */
export const EPERM = "Operation not permitted";

/**
 * `result` is a refusal: the tool ran and failed with its own code (1 or 2), never a tool the run
 * could not start (126, 127), which would pass for isolation; with `reasons`, it said one of them.
 */
export function assertRefused(result: string | undefined, what: string, reasons?: string[]) {
  const [, code, reason] = result?.match(/^fail (\d+) ?(.*)$/) ?? [];
  assert(code === "1" || code === "2", `${what}: not a refusal: ${result}`);
  if (reasons) assert(reasons.includes(reason), `${what}: refused for another reason: ${reason}`);
}

/** The probe run inside the sandbox on `kind`. */
export async function probeInside(kind: SandboxedBackend, iso: Isolation, words: string[]) {
  const { outcome, out, err } = await sandboxed(kind, iso, ["/bin/sh", "./probe.sh", ...words]);
  assertEquals(outcome, { kind: "exited", code: 0 }, err);
  return results(out);
}

/** The control: the same probe file, the same words, run on the host from the export. */
export async function probeOnHost(iso: Isolation, words: string[]) {
  const run = new Deno.Command("/bin/sh", {
    args: ["./probe.sh", ...words],
    cwd: iso.exported.scratch,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await run.output();
  assertEquals(code, 0, new TextDecoder().decode(stderr));
  return results(new TextDecoder().decode(stdout));
}
