import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * #654 — grooming ends with a promotion, between columns read from the board.
 *
 * Groomed items stayed in `Backlog`, and nothing said whether the board even
 * had a column to promote them to. `groom-columns.sh` resolves the intake and
 * ready columns once per run from the board's real Status options, and keeps
 * an answer the user gave once in `backlog-config.yml`, so it is never asked
 * again.
 *
 * Each case runs the shipped script against a stubbed `gh` and asserts what it
 * printed and where it exited — the question is asked by the agent on exit 4,
 * so exit 4 with MISSING= IS "the one-time choice instead of a silent stay".
 */

const GITHUB_DIR = "../../templates/core/skills/board/scripts/github";
const DEFAULTS = ["Backlog", "Ready", "In progress", "In review", "Done"];

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

async function board(
  options: string[] | "unreadable",
  config = "",
  /** Wrap `jq` so every line ends in CRLF, as its Windows build prints them. */
  crlf = false,
): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "groom-columns-" });
  const scripts = `${tmp}/board/scripts/github`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });
  for (const name of ["_config.sh", "groom-columns.sh"]) {
    await Deno.copyFile(scriptPath(`${GITHUB_DIR}/${name}`), `${scripts}/${name}`);
    await Deno.chmod(`${scripts}/${name}`, 0o755);
  }
  await Deno.writeTextFile(
    `${tmp}/.specnaut/backlog-config.yml`,
    `repo: "acme/my-app"\nproject_number: 7\n${config}`,
  );
  const fields = options === "unreadable" ? [] : [{
    id: "PVTSSF_status",
    name: "Status",
    type: "ProjectV2SingleSelectField",
    options: options.map((name, i) => ({ id: `opt_${i}`, name })),
  }];
  await Deno.writeTextFile(
    `${tmp}/bin/gh`,
    `#!/usr/bin/env bash
if [ "\$1" = "auth" ]; then exit 0; fi
if [ "\$1" = "project" ] && [ "\$2" = "view" ]; then echo '{"id":"PVT_stub"}'; exit 0; fi
if [ "\$1" = "project" ] && [ "\$2" = "field-list" ]; then
  ${options === "unreadable" ? 'echo "HTTP 502: Bad Gateway" >&2; exit 1' : ""}
  cat <<'JSON'
${JSON.stringify({ fields })}
JSON
  exit 0
fi
echo "unexpected gh invocation: \$*" >&2
exit 1
`,
  );
  await Deno.chmod(`${tmp}/bin/gh`, 0o755);
  if (crlf) {
    const real = new TextDecoder().decode(
      (await new Deno.Command("bash", { args: ["-c", "command -v jq"] }).output()).stdout,
    ).trim();
    await Deno.writeTextFile(
      `${tmp}/bin/jq`,
      `#!/usr/bin/env bash\n"${real}" "$@" | sed 's/$/\\r/'\n`,
    );
    await Deno.chmod(`${tmp}/bin/jq`, 0o755);
  }
  return tmp;
}

async function run(tmp: string, args: string[] = []) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [`${tmp}/board/scripts/github/groom-columns.sh`, ...args],
    env: { PATH: `${tmp}/bin:${Deno.env.get("PATH")}` },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    out: new TextDecoder().decode(stdout),
    err: new TextDecoder().decode(stderr),
    config: await Deno.readTextFile(`${tmp}/.specnaut/backlog-config.yml`),
  };
}

Deno.test("a board with the default columns resolves without a question", async () => {
  const r = await run(await board(DEFAULTS));
  assertEquals(r.code, 0, r.err);
  assertStringIncludes(r.out, "INTAKE=Backlog\n");
  assertStringIncludes(r.out, "READY=Ready\n");
  assertStringIncludes(r.out, "PROMOTE=yes\n");
});

Deno.test("a board without a ready column exits 4 for the one-time choice, not a silent stay", async () => {
  const r = await run(await board(["Backlog", "Doing", "Done"]));
  assertEquals(r.code, 4, r.out);
  assertStringIncludes(r.out, "MISSING=ready_column=Ready");
  assertStringIncludes(r.out, "OPTIONS=Backlog|Doing|Done");
});

Deno.test("a persisted mapping is used without asking", async () => {
  const r = await run(
    await board(
      ["Inbox", "Groomed", "Doing", "Done"],
      'intake_column: "Inbox"\nready_column: "Groomed"\n',
    ),
  );
  assertEquals(r.code, 0, r.out + r.err);
  assertStringIncludes(r.out, "INTAKE=Inbox\n");
  assertStringIncludes(r.out, "READY=Groomed\n");
});

Deno.test("ready_column none grooms without promoting, and says so", async () => {
  const r = await run(await board(["Backlog", "Doing", "Done"], "ready_column: none\n"));
  assertEquals(r.code, 0, r.out + r.err);
  assertStringIncludes(r.out, "READY=\n");
  assertStringIncludes(r.out, "PROMOTE=no\n");
});

Deno.test("--set persists the answer, so the next run resolves it", async () => {
  const tmp = await board(["Backlog", "Doing", "Done"]);
  const set = await run(tmp, ["--set", "ready_column", "doing"]);
  assertEquals(set.code, 0, set.out + set.err);
  // The board's own spelling is stored, not the user's casing.
  assertStringIncludes(set.config, 'ready_column: "Doing"');
  const again = await run(tmp);
  assertEquals(again.code, 0, again.out);
  assertStringIncludes(again.out, "READY=Doing\n");
});

Deno.test("--set replaces a previous answer instead of appending a second key", async () => {
  const tmp = await board(["Backlog", "Ready", "Doing", "Done"], 'ready_column: "Doing"\n');
  await run(tmp, ["--set", "ready_column", "Ready"]);
  const r = await run(tmp);
  assertEquals((r.config.match(/^ready_column:/gm) ?? []).length, 1, r.config);
  assertStringIncludes(r.out, "READY=Ready\n");
});

Deno.test("--set refuses a column the board does not have", async () => {
  const tmp = await board(["Backlog", "Doing", "Done"]);
  const r = await run(tmp, ["--set", "ready_column", "Ready"]);
  assertEquals(r.code, 4);
  assertEquals(r.config.includes("ready_column"), false, r.config);
});

Deno.test("a board that cannot be read is exit 13, never a guessed column", async () => {
  const r = await run(await board("unreadable"));
  assertEquals(r.code, 13, r.out);
  assertEquals(r.out.includes("READY="), false, r.out);
});

Deno.test("a jq that ends lines in CRLF (its Windows build) still resolves the columns", async () => {
  // CI's Windows runner read every option as "Ready\\r" and matched nothing.
  const r = await run(await board(DEFAULTS, "", true));
  assertEquals(r.code, 0, r.out + r.err);
  assertStringIncludes(r.out, "READY=Ready\n");
});
