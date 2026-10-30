import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import {
  approve,
  bashPath,
  type Harness,
  HOOKS_DIR,
  makeRepo,
  payload,
  type RepoOptions,
  type Run,
  runHook,
  type Sandbox,
  sandbox,
  stamps,
} from "../templates/hooks/hook_sandbox.ts";
import { pathWithoutJq } from "../templates/hooks/hook_path.ts";
import { bash, verdict } from "../templates/hooks/guard_merge_fixture.ts";

/**
 * Spec 048 — `merge-hold.sh` decides whether a landing script may run under
 * `merge: manual`, whatever the command line that reached it. It allows only
 * by printing `merge-hold: run`; the stamp it reads is the one the user's
 * prompt minted through the real `approve-on-prompt.sh`, read by
 * `.specnaut/hooks/merge-approved.sh` with `_approval.sh`'s own code.
 */

const RUN = "merge-hold: run";
const ID: Record<Harness, string> = {
  claude: "3f2c9a1e-7b4d-4e8a-9c21-5d6f0e8b7a10",
  codex: "019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b",
};
const VAR: Record<Harness, string> = {
  claude: "CLAUDE_CODE_SESSION_ID",
  codex: "CODEX_SESSION_ID",
};

/** A project as Specnaut scaffolds it: the scripts, and (unless `hooks: false`) the hooks. */
async function project(
  sb: Sandbox,
  opts: RepoOptions & { hooks?: boolean } = {},
): Promise<string> {
  const repo = await makeRepo(sb, opts);
  if (opts.hooks !== false) await copy(HOOKS_DIR, join(repo, ".specnaut", "hooks"));
  return repo;
}

/** Runs the installed helper from `repo`, in the sandbox env plus `env`. */
async function hold(sb: Sandbox, repo: string, env: Record<string, string> = {}): Promise<Run> {
  const out = await new Deno.Command("bash", {
    args: [bashPath(join(repo, ".specnaut", "scripts", "bash", "merge-hold.sh"))],
    cwd: repo,
    env: { ...sb.env, ...env },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
}

const ran = (r: Run) => r.code === 0 && r.stdout === `${RUN}\n`;
const held = (r: Run) => r.code === 13 && !r.stdout.includes(RUN);

/** One sandbox per test; `fn` gets it and a manual project with hooks. */
function withProject(fn: (sb: Sandbox, repo: string) => Promise<void>) {
  return async () => {
    const sb = await sandbox();
    try {
      await fn(sb, await project(sb));
    } finally {
      await sb.cleanup();
    }
  };
}

Deno.test(
  "no session id in the environment: it runs, and says so when a harness marker is set",
  withProject(async (sb, repo) => {
    const plain = await hold(sb, repo);
    assert(ran(plain), `${plain.code} ${plain.stdout} ${plain.stderr}`);
    assertEquals(plain.stderr, "", "a person in a terminal gets no note");
    const markers: Record<string, string>[] = [{ CLAUDECODE: "1" }, { CODEX_SANDBOX: "seatbelt" }];
    for (const marker of markers) {
      const r = await hold(sb, repo, marker);
      assert(ran(r), JSON.stringify(marker));
      assertStringIncludes(r.stderr, "merge-hold: no session id in the environment — not held");
    }
  }),
);

Deno.test("no guard-merge.sh in the project: it runs (nothing could write the approval)", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb, { hooks: false });
    assert(ran(await hold(sb, repo, { [VAR.claude]: ID.claude })));
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "guard-merge.sh present but the reader missing: held, naming specnaut upgrade",
  withProject(async (sb, repo) => {
    await Deno.remove(join(repo, ".specnaut", "hooks", "merge-approved.sh"));
    const r = await hold(sb, repo, { [VAR.claude]: ID.claude });
    assert(held(r), `${r.code} ${r.stderr}`);
    assertStringIncludes(r.stderr, "specnaut upgrade");
  }),
);

Deno.test("auto runs; a merge-mode.sh that fails counts as manual", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb, { mode: "auto" });
    const env = { [VAR.claude]: ID.claude };
    assert(ran(await hold(sb, repo, env)), "auto");
    await Deno.writeTextFile(
      join(repo, ".specnaut", "scripts", "bash", "merge-mode.sh"),
      "exit 3\n",
    );
    assert(held(await hold(sb, repo, env)), "a failing merge-mode.sh is manual");
  } finally {
    await sb.cleanup();
  }
});

for (const harness of ["claude", "codex"] as const) {
  Deno.test(
    `${harness}: manual runs only on this session's merge stamp, and the hold names its remedy`,
    withProject(async (sb, repo) => {
      const env = { [VAR[harness]]: ID[harness] };
      const before = await hold(sb, repo, env);
      assert(held(before), `${before.code} ${before.stdout} ${before.stderr}`);
      assertMatch(before.stderr, /^specnaut merge-approved: held — .*reply `merge`/);
      assertEquals(before.stderr.trim().split("\n").length, 1, "one line");
      assertEquals(before.stderr.includes("/hooks"), harness === "codex", "the Codex trust hint");
      await approve(sb, harness, repo, "merge");
      const after = await hold(sb, repo, env);
      assert(ran(after), `${after.code} ${after.stderr}`);
      // Stop ends the turn: the stamp goes, and the hold is back.
      await runHook(
        sb,
        "approve-on-prompt.sh",
        harness,
        await payload(harness, "stop", { cwd: repo }),
      );
      assert(held(await hold(sb, repo, env)), "after Stop");
    }),
  );
}

Deno.test(
  "a stamp older than 60 minutes holds",
  withProject(async (sb, repo) => {
    await approve(sb, "claude", repo, "merge");
    const env = { [VAR.claude]: ID.claude };
    assert(ran(await hold(sb, repo, env)), "control: the fresh stamp runs");
    const [stamp] = await stamps(sb);
    const old = new Date(Date.now() - 61 * 60 * 1000);
    await Deno.utime(stamp, old, old);
    assert(held(await hold(sb, repo, env)), "61 minutes old");
  }),
);

Deno.test(
  "a stamp of another kind, another session, another root, or a malformed id holds",
  withProject(async (sb, repo) => {
    await approve(sb, "claude", repo, "release it");
    assertEquals((await stamps(sb)).length, 1, "a release stamp was minted");
    assert(held(await hold(sb, repo, { [VAR.claude]: ID.claude })), "a release stamp");

    await approve(sb, "claude", repo, "merge");
    assert(ran(await hold(sb, repo, { [VAR.claude]: ID.claude })), "control");
    assert(held(await hold(sb, repo, { [VAR.claude]: "another-session" })), "another session");
    const other = await project(sb);
    assert(
      held(await hold(sb, other, { [VAR.claude]: ID.claude })),
      "the same session, another root",
    );
    for (const bad of ["../" + ID.claude, `${ID.claude}/x`, "a b"]) {
      const r = await hold(sb, repo, { [VAR.claude]: bad });
      assert(held(r), `malformed id ${bad}`);
      assertStringIncludes(r.stderr, "not a plain token");
    }
  }),
);

Deno.test(
  "no jq: held, naming jq",
  withProject(async (sb, repo) => {
    await approve(sb, "claude", repo, "merge");
    const env = { [VAR.claude]: ID.claude };
    assert(ran(await hold(sb, repo, env)), "control: jq on PATH");
    const r = await hold(sb, repo, { ...env, PATH: await pathWithoutJq(sb) });
    assert(held(r), `${r.code} ${r.stderr}`);
    assertStringIncludes(r.stderr, "install jq");
  }),
);

Deno.test(
  "both ids set: Claude's wins",
  withProject(async (sb, repo) => {
    await approve(sb, "claude", repo, "merge");
    const both = { [VAR.claude]: ID.claude, [VAR.codex]: "019a-unapproved" };
    assert(ran(await hold(sb, repo, both)), "Claude's id is approved");
    const swapped = { [VAR.claude]: "claude-unapproved", [VAR.codex]: ID.claude };
    assert(held(await hold(sb, repo, swapped)), "Codex's id is never read when Claude's is set");
  }),
);

Deno.test(
  "the session reader does not widen the hook: guard-merge on Codex with no turn_id still denies",
  withProject(async (sb, repo) => {
    await approve(sb, "codex", repo, "merge");
    assert(
      ran(await hold(sb, repo, { [VAR.codex]: ID.codex })),
      "the script reads it with no turn",
    );
    const push = (extra: Record<string, unknown>) =>
      bash(sb, "codex", repo, "git push origin main", extra);
    assertEquals(verdict(await push({})), "allow", "control: the turn's own call");
    assertEquals(verdict(await push({ turn_id: "" })), "deny", "an empty turn_id");
    const p = await payload("codex", "pre_tool_use_bash", { cwd: repo });
    delete p.turn_id;
    const r = await runHook(sb, "guard-merge.sh", "codex", {
      ...p,
      tool_input: { command: "git push origin main" },
    });
    assertEquals(verdict(r), "deny", "no turn_id at all");
  }),
);
