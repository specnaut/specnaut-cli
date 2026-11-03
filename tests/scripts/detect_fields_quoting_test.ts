import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

// detect-fields.sh prints KEY=value lines for `eval`: each value reads back exactly.

const GITHUB = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/github", import.meta.url),
);

const GH = `#!/usr/bin/env bash
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1" = "project" ] && [ "$2" = "field-list" ]; then cat fields.json; exit 0; fi
if [ "$1" = "project" ] && [ "$2" = "view" ]; then
  if [[ "$*" == *"--jq"* ]]; then echo 'PVT_stub'; else echo '{"id":"PVT_stub"}'; fi
  exit 0
fi
if [ "$1" = "api" ]; then echo '{}'; exit 0; fi
exit 1
`;

async function detect(fields: unknown[], names: string[]) {
  const dir = await Deno.makeTempDir({ prefix: "detect-fields-quoting-" });
  try {
    const scripts = join(dir, "board", "scripts", "github");
    await Deno.mkdir(scripts, { recursive: true });
    await Deno.mkdir(join(dir, ".specnaut"));
    await Deno.mkdir(join(dir, "bin"));
    for (const f of ["_config.sh", "detect-fields.sh"]) {
      await Deno.copyFile(join(GITHUB, f), join(scripts, f));
    }
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      'repo: "acme/my-app"\nproject_number: 7\n',
    );
    await Deno.writeTextFile(
      join(dir, "fields.json"),
      JSON.stringify({ fields }),
    );
    await Deno.writeTextFile(join(dir, "bin", "gh"), GH);
    const probe = [
      'export PATH="$PWD/bin:$PATH"; chmod +x bin/gh board/scripts/github/*.sh',
      'out=$(board/scripts/github/detect-fields.sh) || exit 9; eval "$out"',
      ...names.map((n) => `printf '%s=[%s]\\n' ${n} "\${${n}-<unset>}"`),
    ].join("\n");
    const r = await new Deno.Command("bash", {
      args: ["-c", probe],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    return {
      code: r.code,
      out: dec.decode(r.stdout),
      err: dec.decode(r.stderr),
      ran: await exists(join(dir, "ran.txt")),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

const select = (id: string, name: string, options: { id: string; name: string }[]) => ({
  id,
  name,
  type: "ProjectV2SingleSelectField",
  options,
});

Deno.test("detect-fields: an option name of any shape round-trips as data under eval", async () => {
  for (
    const name of [
      "Done$(touch ran.txt)",
      "Done`touch ran.txt`",
      'Done";touch ran.txt;"',
      "Done';touch ran.txt;'",
      "Two words",
      "Done\ntouch ran.txt",
    ]
  ) {
    const r = await detect(
      [select("F_status", "Status", [{ id: "opt_a", name }])],
      ["STATUS_OPT_NAMES", "STATUS_FIELD_ID", "PROJECT_NODE_ID"],
    );
    assertEquals(r.code, 0, r.err);
    assertEquals(r.ran, false, name);
    assertEquals(
      r.out,
      `STATUS_OPT_NAMES=[${name}]\nSTATUS_FIELD_ID=[F_status]\nPROJECT_NODE_ID=[PVT_stub]\n`,
    );
  }
});

Deno.test("detect-fields: an id of any shape round-trips as data under eval", async () => {
  const odd = "x$(touch ran.txt);touch ran.txt";
  const r = await detect(
    [
      select(odd, "Status", [{ id: odd, name: "Backlog" }]),
      { id: odd, name: "Estimate", type: "ProjectV2Field" },
      { id: odd, name: "Start date", type: "ProjectV2Field" },
    ],
    [
      "STATUS_FIELD_ID",
      "STATUS_OPT_BACKLOG",
      "STATUS_FIRST_OPT_ID",
      "ESTIMATE_FIELD_ID",
      "STARTDATE_FIELD_ID",
    ],
  );
  assertEquals(r.code, 0, r.err);
  assertEquals(r.ran, false);
  assertEquals(r.out.trim().split("\n").length, 5, r.out);
  for (const line of r.out.trim().split("\n")) {
    assertEquals(line.endsWith(`=[${odd}]`), true, line);
  }
});

Deno.test("detect-fields: plain ids print as they always did", async () => {
  const r = await detect(
    [select("F_status", "Status", [{ id: "opt_a", name: "Backlog" }])],
    ["STATUS_OPT_BACKLOG", "STATUS_FIELD_FORM"],
  );
  assertEquals(r.out, "STATUS_OPT_BACKLOG=[opt_a]\nSTATUS_FIELD_FORM=[local]\n");
});
