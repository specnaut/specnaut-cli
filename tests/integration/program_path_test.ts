import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { runCheck } from "../../src/cli/handlers/check_handler.ts";
import { runReview } from "../../src/cli/handlers/review_handler.ts";
import { DenoSubprocessRunner } from "../../src/infrastructure/deno_subprocess.ts";
import { GhCli } from "../../src/infrastructure/gh_cli.ts";
import { plantGit, ran, withPath } from "../helpers/planted_git.ts";

/**
 * The programs the binary starts by name beside git, `specnaut check`'s toolchain probe, the
 * review's trust call and `gh`, are looked up as git is: only on PATH entries outside the tree they
 * start in (`git_path.ts`). They start in the folder the binary runs in, so the checkout here is a
 * folder under it, whose `bin` holds a `git` and a `gh` of its own, first on the PATH. Each case
 * leaves no real program after it, so nothing reaches the network, and what proves the planted one
 * never ran on Windows, where it leaves no mark (`plantGit`), is the entry the error names.
 */

type Checkout = { bin: string; fired: string; outside: string };

/** `fn` given a planted `bin` under the working folder and an empty folder outside it. */
async function inCheckout(fn: (c: Checkout) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".planted-program-" });
  const outside = await Deno.makeTempDir({ prefix: "planted-program-outside-" });
  const c = { bin: join(dir, "bin"), fired: join(outside, "fired"), outside };
  try {
    await plantGit(c.bin, c.fired, "git");
    await plantGit(c.bin, c.fired, "gh");
    await fn(c);
    assertEquals(await ran(c.fired), false, "a planted program ran");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
}

const leftOut = (bin: string) =>
  `the entry "${bin}" was left out because it is inside the repository`;

/** What `fn` printed through `console.log`, with what it returned. */
async function printed(fn: () => Promise<number>): Promise<{ code: number; said: string }> {
  const log = console.log;
  const said: string[] = [];
  console.log = (...parts: unknown[]) => said.push(parts.join(" "));
  try {
    return { code: await fn(), said: said.join("\n") };
  } finally {
    console.log = log;
  }
}

/** Each probe row, by the program it names, with the entry the PATH left out. */
function assertRows(said: string, missing: (program: string) => string, bin: string) {
  for (const program of ["git", "gh", "deno"]) {
    const row = said.split("\n").find((l) => l.trimStart().startsWith(program));
    assert(row?.includes(`${missing(program)}; ${leftOut(bin)}`), `${program}: ${row}`);
  }
}

/** The PATH each case runs on: the planted entry first and nothing after, or only that one. */
const PATHS = {
  ahead: { entries: (c: Checkout) => [c.bin, c.outside], missing: (p: string) => notOn(p) },
  only: { entries: (c: Checkout) => [c.bin], missing: (_: string) => NO_ENTRY },
};
const notOn = (program: string) => `${program} is not on the PATH`;
const NO_ENTRY = "no PATH entry outside the repository";

for (const [name, { entries, missing }] of Object.entries(PATHS)) {
  Deno.test(`check's probe skips a git and a gh the checkout holds (${name}), naming the entry`, () =>
    inCheckout(async (c) => {
      const said = await withPath(entries(c), () => printed(() => runCheck(CHECK)));
      assertEquals(said.code, 1);
      assertRows(said.said, missing, c.bin);
    }));

  Deno.test(`the review's trust call skips a gh the checkout holds (${name}), naming the entry`, () =>
    inCheckout(async (c) => {
      const said = await withPath(entries(c), () => printed(() => runReview(TRUST)));
      const why = `gh exited 127: ${missing("gh")}; ${leftOut(c.bin)}`;
      assertEquals(said, { code: 1, said: `untrusted the forge could not be read: ${why}` });
    }));

  Deno.test(`gh's backlog calls skip a gh the checkout holds (${name}), naming the entry`, () =>
    inCheckout(async (c) => {
      const gh = new GhCli(new DenoSubprocessRunner());
      await withPath(entries(c), async () => {
        assertEquals(await gh.isAvailable(), false);
        await assertRejects(
          () => gh.listIssues("acme/my-app", "type:"),
          Error,
          `gh issue list failed: ${missing("gh")}; ${leftOut(c.bin)}`,
        );
      });
    }));
}

const CHECK = { kind: "check", projectMode: false } as const;
const TRUST = { kind: "review", sub: "trust", pr: "12", head: "c".repeat(40) } as const;
