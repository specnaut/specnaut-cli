import { assertEquals } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { toolsIn } from "../integration/hook_tools.ts";
import { CALL, hook, launched, START } from "./resolve_verifier_fixture.ts";
import { fired, ifMissing, inLayout, type Layout } from "./resolve_verifier_layout.ts";

/**
 * What the hooks do past the table of resolve_verifier_test.ts once they have cleaned the PATH: the
 * work they still do with what is left, and the locks and starts they refuse when what was dropped
 * could have been what they needed. Each run plants markers in the dropped entry; none may fire.
 */

Deno.test({
  name:
    "with an in-repo PATH entry and no lock, the call runs and the pass is still removed, by the real tools",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      await Deno.remove(join(l.state, "specnaut", "review-lock", "s-1.json"));
      // The markers' folder first: had it been searched, its `git` and `rm` would have run.
      const r = { entries: [l.bin, join(l.tmp, "outside", "real"), l.tools], cwd: l.repo, bash };
      assertEquals(await hook(l, r, "review-lock.sh", CALL), { exit: 0 }, "no lock");
      const pass = join(l.repo, ".git", "specnaut", "review-pass.json");
      await Deno.mkdir(join(l.repo, ".git", "specnaut"));
      await Deno.writeTextFile(pass, "{}\n");
      const ls = '{"tool_input":{"command":"ls"}}';
      assertEquals(await hook(l, r, "review-gate.sh", ls), { exit: 0 }, "a command not a review");
      const left = await Deno.lstat(pass).then(() => true, ifMissing(false));
      assertEquals(left, false, "the pass outlived ls");
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name:
    "with the checkout's lock and nothing left on the PATH to ask git with, the call is refused",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      // No per-user copy: only the checkout's own lock, which git is needed to find, holds.
      await Deno.remove(join(l.state, "specnaut", "review-lock", "s-1.json"));
      await Deno.mkdir(join(l.repo, ".git", "specnaut", "review-lock"), { recursive: true });
      await Deno.writeTextFile(join(l.repo, ".git", "specnaut", "review-lock", "s-1.json"), "{}\n");
      const r = { entries: [""], cwd: l.bin, bash };
      const want = { refused: "is empty", entry: "", exit: 2 };
      assertEquals(await hook(l, r, "review-lock.sh", CALL), want);
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name: "with no `cat` left once the PATH is cleaned, the hooks still read the call and refuse",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      // git, env and rm, but no cat: an input read through the PATH would be empty, no session
      // and no start found, and both calls let through.
      await Deno.mkdir(join(l.tmp, "few"));
      const few = await toolsIn(join(l.tmp, "few"), ["git", "env", "rm"]);
      const r = { entries: [l.bin, few], cwd: l.repo, bash };
      const want = { refused: "is inside the repository", entry: l.bin, exit: 2 };
      assertEquals(await hook(l, r, "review-lock.sh", CALL), want, "the held lock's copy");
      assertEquals(await hook(l, r, "review-gate.sh", START), want, "a review's start");
      // The same start with a tab, which the hook reads JSON-escaped, as `\t`.
      const tab = JSON.stringify({ tool_input: { command: "specnaut review\tstart 1" } });
      assertEquals(await hook(l, r, "review-gate.sh", tab), want, "a start spelled with a tab");
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

/**
 * A `BASH_ENV` file and exported functions named like the builtins the launcher, the rule and the
 * hook run before the PATH is cleaned (a bash run as /bin/sh imports them too), each recording its
 * name in the layout's markers when it runs.
 */
async function startupMarkers(l: Layout): Promise<Record<string, string>> {
  const mark = (name: string) => `echo ${name} >>'${join(l.tmp, "fired")}'`;
  const startup = join(l.tmp, "outside", "startup");
  await Deno.writeTextFile(startup, `${mark("BASH_ENV")}\n`);
  const env: Record<string, string> = { BASH_ENV: startup };
  for (const name of ["cd", "pwd", "command", "local"]) {
    env[`BASH_FUNC_${name}%%`] = `() {  ${mark(name)}; builtin ${name} "$@"\n}`;
  }
  return env;
}

Deno.test({
  name: "launched as settings.json registers it, nothing of the environment runs before the hook",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const env = await startupMarkers(l);
      const r = { entries: [join(l.tmp, "outside", "real"), l.tools], cwd: l.repo, bash };
      const want = { resolved: l.outside, path: r.entries.join(DELIMITER) };
      // `/bin/sh` as the system has it, and bash started as `sh`: a /bin/sh that is not bash
      // imports no function, so only the second holds the launcher to it on every runner.
      const sh = join(l.tmp, "shell", "sh");
      await Deno.mkdir(join(l.tmp, "shell"));
      await Deno.symlink(bash, sh);
      for (const shell of ["/bin/sh", sh]) {
        assertEquals(await launched(l, r, "review-lock.sh", CALL, env, shell), want, shell);
        assertEquals(await fired(l), "", `BASH_ENV or an exported function ran, ${shell}`);
      }
    }),
});

Deno.test({
  name: "with an in-repo PATH entry dropped, a review start spelled with shell quoting is refused",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const r = { entries: [l.bin, l.tools], cwd: l.repo, bash };
      const want = { refused: "is inside the repository", entry: l.bin, exit: 2 };
      // The shell removes each quote and backslash below before `specnaut` reads its words.
      for (
        const line of [
          'specnaut "review" start 1',
          "specnaut 'review' start 1",
          `specnaut re"vi"ew st'ar't 1`,
          "specnaut rev\\iew start 1",
          "specnaut review\\ start 1",
          "specnaut rev\\\niew start 1",
          "specnaut $'review' start 1",
        ]
      ) {
        const start = JSON.stringify({ tool_input: { command: line } });
        assertEquals(await hook(l, r, "review-gate.sh", start), want, line);
      }
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

/** The hook's input for a Bash call of `command`, run from `cwd`, with a description if given. */
const bashCall = (command: string, at: { cwd?: string; description?: string } = {}) =>
  JSON.stringify({
    cwd: at.cwd ?? "/work",
    tool_input: { command, ...(at.description ? { description: at.description } : {}) },
  });

Deno.test({
  name: "with an in-repo PATH entry dropped, a line running specnaut from the PATH is refused",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const r = { entries: [l.bin, l.tools], cwd: l.repo, bash };
      const want = { refused: "is inside the repository", entry: l.bin, exit: 2 };
      // Each runs a `specnaut` the session's own PATH may find: after a separator, in capitals, past
      // a line continuation, past backslashes that would leave a quote if paired the wrong way.
      for (
        const line of [
          "s=start; specnaut review $s 1",
          "specnaut verify-scripts",
          "x && SPECNAUT x",
          "specnaut review start 1",
          "cd /work; spec\\\nnaut x",
          'echo \\\\n"; specnaut x',
        ]
      ) assertEquals(await hook(l, r, "review-gate.sh", bashCall(line)), want, line);
      // A value before the command whose backslashes, paired the wrong way, would leave a quote
      // and a key of its own: the command is still read where it is.
      const fakes = ['\\\\n"tool_input\\\\n":', 'x\\\\n","command":"ls', '\\\\n"{"command":"ls'];
      for (const cwd of fakes) {
        const input = bashCall("specnaut x", { cwd });
        assertEquals(await hook(l, r, "review-gate.sh", input), want, cwd);
      }
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name: "with an entry dropped, a path, a folder or a description holding the name is let through",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const r = { entries: [l.bin, l.tools], cwd: l.repo, bash };
      for (
        const input of [
          bashCall("cat .specnaut/workflow.yml"),
          bashCall("ls specnaut-cli/"),
          bashCall("git add .specnaut/hooks/x.sh"),
          bashCall("ls", { description: "List the specnaut folder" }),
          bashCall("ls", { cwd: "/work/specnaut" }),
        ]
      ) assertEquals(await hook(l, r, "review-gate.sh", input), { exit: 0 }, input);
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});
