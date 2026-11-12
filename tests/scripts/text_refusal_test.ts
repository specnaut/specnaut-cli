import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type Project, project } from "./backlog_tracker_fixture.ts";
import {
  CLEAN_BODY,
  CLEAN_TITLE,
  ENV_VALUE,
  HIDDEN_SAMPLES,
  SECRET_NAMES,
  SECRET_SAMPLES,
  SURVIVORS,
} from "./secret_samples.ts";

/**
 * `text_refusal`, the one rule every backlog write meets, sourced from a real
 * install of `_backlog_plan.sh`: the function the writers call, every sample
 * judged in one bash process.
 */

/** Every sample, with the verdict text_refusal prints for it: its status, then its class. */
const CASES: [string, string][] = [
  ...SECRET_SAMPLES.map((t): [string, string] => [t, "1 secret"]),
  ...HIDDEN_SAMPLES.map((t): [string, string] => [t, "1 hidden"]),
  ...[...SURVIVORS, CLEAN_BODY, CLEAN_TITLE].map((t): [string, string] => [t, "0 "]),
];

/** Each line is labelled: a sample's index, or the variable that holds the value. */
const JUDGE_ALL = `
  for i in $(seq 0 ${CASES.length - 1}); do c=$(text_refusal <"samples/$i"); echo "$i $? $c"; done
  for n in ${SECRET_NAMES.join(" ")}; do
    c=$(export "$n=${ENV_VALUE}"; text_refusal <env-sample); echo "$n $? $c"
  done`;

Deno.test("text_refusal names the class of every refused sample, and passes clean text", async () => {
  const p = await project("local");
  try {
    await Deno.mkdir(join(p.dir, "samples"));
    for (const [i, [t]] of CASES.entries()) await p.write(`samples/${i}`, t);
    await p.write("env-sample", `see ${ENV_VALUE} here`);
    const out = await verdicts(p, JUDGE_ALL);
    const want = [
      ...CASES.map(([, v], i) => `${i} ${v}`),
      ...SECRET_NAMES.map((n) => `${n} 1 secret`),
    ];
    assertEquals(out.lines, want, out.stderr);
  } finally {
    await p.cleanup();
  }
});

/**
 * A scan that could not run is neither clean nor a refusal: status 2, no class,
 * and one fixed line on stderr naming why. Each case breaks one tool with a
 * stand-in first on PATH.
 */
const UNSCANNED: { why: string; tool: string; status: number; line: string }[] = [
  { why: "a grep that fails", tool: "grep", status: 2, line: "the secret scan could not run" },
  { why: "a text that cannot be read", tool: "tr", status: 1, line: "the text could not be read" },
];

for (const { why, tool, status, line } of UNSCANNED) {
  Deno.test(`text_refusal stops on ${why}, and gives no verdict`, async () => {
    const p = await project("local");
    try {
      await Deno.mkdir(join(p.dir, "broken"));
      await p.write(`broken/${tool}`, `#!/usr/bin/env bash\nexit ${status}\n`);
      const out = await verdicts(
        p,
        `chmod +x broken/${tool}
        c=$(PATH="$PWD/broken:$PATH" text_refusal <<<"plain words"); echo "$? $c"`,
      );
      assertEquals([out.lines, out.stderr], [["2 "], `bash: ${line}\n`]);
    } finally {
      await p.cleanup();
    }
  });
}

/** What leaves no scan to run: the scan itself gone, its patterns gone, or one of them. */
const UNINSTALLED: { why: string; breakIt: (bash: string) => Promise<void> }[] = [
  { why: "no secret scan is installed", breakIt: (b) => Deno.remove(join(b, "_report_text.sh")) },
  { why: "its patterns are missing", breakIt: (b) => Deno.remove(join(b, "_secret_patterns.txt")) },
  {
    why: "one of its patterns is missing",
    breakIt: async (b) => {
      const f = join(b, "_secret_patterns.txt");
      const kept = (await Deno.readTextFile(f)).split("\n").filter((l) =>
        !/^TOKEN_LIKE_RE /.test(l)
      );
      await Deno.writeTextFile(f, kept.join("\n"));
    },
  },
];

for (const { why, breakIt } of UNINSTALLED) {
  Deno.test(`text_refusal stops when ${why}, and gives no verdict`, async () => {
    const p = await project("local");
    try {
      await breakIt(join(p.dir, ".specnaut/scripts/bash"));
      const missing = await verdicts(p, `c=$(text_refusal <<<"plain words"); echo "$? $c"`);
      assertEquals([missing.lines, missing.stderr], [["2 "], "bash: the secret scan is missing\n"]);
    } finally {
      await p.cleanup();
    }
  });
}

Deno.test("text_refusal judges the same in a UTF-8 locale", async () => {
  const p = await project("local");
  try {
    const clean = [...SURVIVORS, CLEAN_BODY, CLEAN_TITLE];
    await Deno.mkdir(join(p.dir, "samples"));
    for (const [i, t] of clean.entries()) await p.write(`samples/${i}`, t);
    await p.write("hidden", HIDDEN_SAMPLES.find((t) => t.includes("\u200b"))!);
    const script = `
      for i in $(seq 0 ${clean.length - 1}); do c=$(text_refusal <"samples/$i"); echo "$? $c"; done
      c=$(text_refusal <hidden); echo "$? $c"`;
    const want = [...clean.map(() => "0 "), "1 hidden"];
    const locales: Record<string, string>[] = [
      { LC_ALL: "en_US.UTF-8" },
      { LC_ALL: "", LC_CTYPE: "", LANG: "C.UTF-8" },
    ];
    for (const env of locales) {
      const out = await verdicts(p, script, env);
      assertEquals(out.lines, want, `${JSON.stringify(env)}\n${out.stderr}`);
    }
  } finally {
    await p.cleanup();
  }
});

/** `script` run in one bash process, after sourcing the installed `_backlog_plan.sh`. */
async function verdicts(p: Project, script: string, env: Record<string, string> = {}) {
  const out = await new Deno.Command("bash", {
    args: ["-c", `. .specnaut/scripts/backlog/_backlog_plan.sh\n${script}`],
    cwd: p.dir,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return {
    lines: dec.decode(out.stdout).split("\n").filter((l) => l),
    stderr: dec.decode(out.stderr),
  };
}
