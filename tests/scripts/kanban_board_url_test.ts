import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  backendDir,
  backendHarness,
  readCalls,
  type Run,
  runScript,
  scriptSource,
  stub,
  toolsOnlyPath,
} from "./backend_scripts_fixture.ts";

/**
 * `kanban.sh` (cli#803): each backend's `_board.sh` resolves the board's
 * browser address or says why it cannot, and the verb prints it. Every
 * tracker CLI is a stand-in logging its argv, so a case reads what was asked.
 */

const GITHUB = 'repo: "acme/my-app"\nproject_number: 7\n';
const GITLAB = (id: string) => `host: "https://gitlab.example.com"\nproject_id: "${id}"\n`;
const CLOUD = 'backend: cloud\napi_url: "https://api.example.com"\nproject_key: "ACME"\n';

/** Logs its argv to `<tmp>/calls`, one call a line, then runs `body`. */
const logged = (body: string) =>
  `echo "$(basename "$0") $*" >> "$(dirname "$0")/../calls"\n${body}`;

/** A project on `backend` holding `config`, its stand-ins, then `kanban.sh <args>`. */
async function kanban(
  backend: string,
  config: string | null,
  stubs: Record<string, string>,
  args: ReadonlyArray<string> = ["--no-open"],
): Promise<Run & { calls: string; tmp: string }> {
  const extra = [`${backend}/_board.sh`, "_open_url.sh", "kanban.sh"];
  if (backend === "cloud") extra.push("_issue_text.sh");
  const tmp = await backendHarness(backend, config, extra);
  for (const [name, body] of Object.entries(stubs)) await stub(tmp, name, logged(body));
  const run = await runScript(tmp, `${backendDir(tmp, backend)}/kanban.sh`, args);
  return { ...run, calls: await readCalls(`${tmp}/calls`), tmp };
}

/** A gh whose answer is `lines`, one a line. */
const ghAnswers = (...lines: string[]) => ({
  gh: `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")}`,
});

Deno.test("github: the board URL is the one gh reports, org or user owner", async () => {
  for (
    const url of [
      "https://github.com/orgs/acme/projects/7",
      "https://github.com/users/acme/projects/7",
    ]
  ) {
    const r = await kanban("github", GITHUB, ghAnswers(url));
    assertEquals([r.code, r.out], [0, `URL: ${url}`], r.err);
    assertEquals(r.calls, "gh project view 7 --owner acme --format json --jq .url\n");
  }
});

Deno.test("github: an answer that is not this project's plain board URL is refused, exit 13", async () => {
  for (
    const url of [
      "https://evil.example/orgs/acme/projects/7",
      "http://github.com/orgs/acme/projects/7",
      "https://github.com/orgs/acme/projects/8",
      "https://github.com/teams/acme/projects/7",
      "https://github.com/orgs/acme/projects/7?x=1",
    ].map((url) => [url]).concat([[
      "https://github.com/orgs/acme/projects/7",
      "https://github.com/orgs/acme/projects/7",
    ]])
  ) {
    const r = await kanban("github", GITHUB, ghAnswers(...url));
    assertEquals([r.code, r.out], [13, ""], `${url}: ${r.out}${r.err}`);
  }
});

Deno.test("github: gh failing says how to fix access, exit 13", async () => {
  const r = await kanban("github", GITHUB, { gh: 'echo "HTTP 401" >&2; exit 4' });
  assertEquals([r.code, r.out], [13, ""], r.err);
  assertStringIncludes(r.err, "gh auth status");
  assertStringIncludes(r.err, "gh auth refresh -s read:project");
  assertEquals(r.calls.split("\n")[0], "gh project view 7 --owner acme --format json --jq .url");
});

Deno.test({
  name: "github: no gh on PATH is the same exit 13, never a guessed URL",
  // A PATH of links to the few tools the scripts run; Windows links need a privilege.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const tmp = await backendHarness("github", GITHUB, [
      "github/_board.sh",
      "_open_url.sh",
      "kanban.sh",
    ]);
    const tools = await toolsOnlyPath(["bash", "dirname", "awk"]);
    const r = await runScript(tmp, `${backendDir(tmp, "github")}/kanban.sh`, ["--no-open"], tools);
    assertEquals([r.code, r.out], [13, ""], r.err);
    assertStringIncludes(r.err, "gh auth status");
  },
});

Deno.test("gitlab: a path project_id is the board's path, with no lookup", async () => {
  const r = await kanban("gitlab", GITLAB("acme/my-app"), { glab: "exit 1" });
  assertEquals([r.code, r.out, r.calls], [
    0,
    "URL: https://gitlab.example.com/acme/my-app/-/boards",
    "",
  ]);
});

Deno.test("gitlab: a numeric project_id is resolved through the API, as item_url does", async () => {
  const r = await kanban("gitlab", GITLAB("1234"), {
    glab: `echo '{"id":1234,"path_with_namespace":"acme/my-app"}'`,
  });
  assertEquals([r.code, r.out], [0, "URL: https://gitlab.example.com/acme/my-app/-/boards"], r.err);
  assertEquals(r.calls, "glab api projects/1234\n");
});

Deno.test("gitlab: a failed lookup, or one naming no plain path, is exit 13", async () => {
  for (
    const body of [
      'echo "401 unauthorized" >&2; exit 1',
      `echo '{"id":1234}'`,
      `echo '{"path_with_namespace":"acme/my app"}'`,
    ]
  ) {
    const r = await kanban("gitlab", GITLAB("1234"), { glab: body });
    assertEquals([r.code, r.out], [13, ""], `${body}: ${r.err}`);
    assertStringIncludes(r.err, "glab auth status");
    assertEquals(r.calls, "glab api projects/1234\n", "a stand-in that never ran proves nothing");
  }
});

Deno.test("cloud: no board address and no credential needed, so the fallback, logged out too", async () => {
  for (const specnaut of ["echo tok", 'echo "not signed in" >&2; exit 1']) {
    const r = await kanban("cloud", CLOUD, { specnaut, curl: "exit 1" });
    assertEquals(r.code, 0, r.err);
    assertEquals(r.out, "CLOUD: project ACME - open the board from the Specnaut Cloud web app");
    assertEquals(r.calls, "", "kanban sends no request: no token is asked for");
  }
});

Deno.test("cloud: the board helper never reads the API address", async () => {
  const src = await Deno.readTextFile(scriptSource("cloud/_board.sh"));
  const code = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  assert(!/API_URL|API_BASE/.test(code), "an API base is not a web origin");
});

Deno.test("local: the index is named, and no launcher is ever asked", async () => {
  const launchers = { uname: "echo Darwin", open: "", "xdg-open": "", rundll32: "" };
  const r = await kanban("local", null, launchers, []);
  assertEquals([r.code, r.out, r.calls], [0, "LOCAL: .specnaut/backlog.md", ""], r.err);
});

Deno.test("kanban.sh opens the URL it printed, as one argument", async () => {
  const r = await kanban("github", GITHUB, {
    ...ghAnswers("https://github.com/orgs/acme/projects/7"),
    uname: "echo Darwin",
    open: "",
  }, []);
  assertEquals(
    [r.code, r.out],
    [0, "URL: https://github.com/orgs/acme/projects/7\nOPEN: open"],
    r.err,
  );
  assertStringIncludes(r.calls, "open https://github.com/orgs/acme/projects/7\n");
});

Deno.test("a missing config, or each unfilled field, is exit 2 naming it", async () => {
  const cases: ReadonlyArray<[string, string | null, string]> = [
    ["github", null, "backlog-config.yml not found"],
    ["github", "project_number: 7\n", "missing 'repo'"],
    ["github", 'repo: "acme/my-app"\nproject_number: ""\n', "missing 'project_number'"],
    ["gitlab", 'project_id: "acme/my-app"\n', "missing 'host'"],
    ["gitlab", "host: gitlab.example.com\nproject_id: # fill in\n", "missing 'project_id'"],
    ["cloud", 'project_key: "ACME"\n', "missing 'api_url'"],
    ["cloud", 'api_url: "https://api.example.com"\n', "missing 'project_key'"],
  ];
  for (const [backend, config, says] of cases) {
    const r = await kanban(backend, config, { gh: "", glab: "", specnaut: "echo tok" });
    assertEquals([r.code, r.out, r.calls], [2, "", ""], `${backend} ${config}: ${r.err}`);
    assertStringIncludes(r.err, says, `${backend} ${config}`);
  }
});

Deno.test("an unknown argument is a usage error, exit 2", async () => {
  const r = await kanban("local", null, {}, ["--open-twice"]);
  assertEquals(r.code, 2);
  assertStringIncludes(r.err, "usage: kanban.sh [--no-open]");
});
