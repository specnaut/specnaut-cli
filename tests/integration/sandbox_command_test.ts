import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { snapshot } from "../helpers/tree_snapshot.ts";
import { DENO_DIR } from "./spawn_env.ts";

/**
 * `specnaut sandbox`, run through `main` as a user's shell runs it (cli#795, from the retired
 * parity scenario `sandbox`). Which backends a host offers varies, so these pin what holds on
 * every host: the shape of the probe's report and its exit code, and that exec on a commit never
 * exported runs nothing.
 */

const KINDS = ["container", "bwrap", "seatbelt"];
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A cap or a stop limit is said only under the backend that is offered. */
function assertGapsUnderOffered(lines: string[]): void {
  let offered: string | null = null;
  for (const line of lines) {
    const [word, kind] = line.split(" ");
    if (word === "AVAILABLE") offered = kind;
    else if (word === "UNAVAILABLE") offered = null;
    else assertEquals(kind, offered, `${line} is not under its AVAILABLE line`);
  }
}

Deno.test("sandbox probe: one line per backend in selection order, then the first one offered", async () => {
  const { code, stdout, stderr } = await runSpecnaut(["sandbox", "probe"]);
  const lines = stdout.trimEnd().split("\n");
  const last = lines.pop() ?? "";
  assertMatch(last, /^BACKEND (container|bwrap|seatbelt|static)$/, stderr);
  const verdicts = lines.filter((l) => /^(AVAILABLE|UNAVAILABLE) /.test(l));
  assertEquals(verdicts.map((l) => l.split(" ")[1]), KINDS, stdout);
  for (const line of lines) {
    assertMatch(line, /^(AVAILABLE|UNAVAILABLE|UNCAPPED|LIMIT) (container|bwrap|seatbelt)( .+)?$/);
  }
  assertGapsUnderOffered(lines);
  const first = verdicts.find((l) => l.startsWith("AVAILABLE "))?.split(" ")[1] ?? "static";
  assertEquals(last, `BACKEND ${first}`);
  assertEquals(code, first === "static" ? 1 : 0, stderr);
});

Deno.test("sandbox exec on a commit never exported exits 125, runs nothing, writes nothing", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-sandbox-cmd-" }));
  try {
    const [work, home, cache] = ["work", "home", "cache"].map((d) => join(root, d));
    for (const dir of [work, home, cache]) await Deno.mkdir(dir);
    const before = await snapshot(root);
    assertEquals([...before.keys()].sort(), ["cache", "home", "work"]);
    const { code, stdout, stderr } = await runSpecnaut(
      ["sandbox", "exec", SHA, "--", "/bin/echo", "hi"],
      { cwd: work, env: { HOME: home, XDG_CACHE_HOME: cache, DENO_DIR } },
    );
    assertEquals(code, 125, stderr);
    // The command's own output is passed through: `hi` here would mean echo ran.
    assertEquals(stdout, "");
    assertMatch(stderr, new RegExp(`not run: (no export of ${SHA}|no backend)`));
    assertEquals(await snapshot(root), before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
