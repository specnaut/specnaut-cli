import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { run, withServer } from "./cloud_stub.ts";

// view.sh run without a terminal, as an agent runs it, returns the whole issue.
//
// The stub imitates what real gh prints, as measured on gh 2.102.0: outside a
// terminal `--comments` prints the comments alone, and nothing when there are
// none. These tests do not call real gh, so they cannot notice gh changing that.

const GITHUB = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/github", import.meta.url),
);

const BODY = "title:\tA title\nstate:\tOPEN\nparent:\t#7\n--\nThe body.\n" +
  "created:\t2099-01-01T00:00:00Z\n";

const GH = `#!/usr/bin/env bash
if [ "$1" = "auth" ]; then exit 0; fi
case "$*" in
  *--json*) kind=json ;;
  *--comments*) kind=comments ;;
  *) kind=plain ;;
esac
if [ "$kind" = "\${GH_FAIL:-}" ]; then echo "gh: refused" >&2; exit 1; fi
case "$kind" in
  json)
    while [ "$1" != "--jq" ]; do shift; done
    printf '{"createdAt":"2026-01-02T03:04:05Z"}' | jq -r "$2" | tr -d '\\r'
    ;;
  plain) cat body.txt ;;
  comments) cat comments.txt ;;
esac
`;

async function view(comments: string, fail = "") {
  const dir = await Deno.makeTempDir({ prefix: "view-sh-" });
  try {
    const scripts = join(dir, "board", "scripts", "github");
    await Deno.mkdir(scripts, { recursive: true });
    await Deno.mkdir(join(dir, ".specnaut"));
    await Deno.mkdir(join(dir, "bin"));
    for (const f of ["_config.sh", "view.sh"]) {
      await Deno.copyFile(join(GITHUB, f), join(scripts, f));
    }
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      'repo: "acme/my-app"\nproject_number: 7\n',
    );
    await Deno.writeTextFile(join(dir, "body.txt"), BODY);
    await Deno.writeTextFile(join(dir, "comments.txt"), comments);
    await Deno.writeTextFile(join(dir, "bin", "gh"), GH);
    const r = await new Deno.Command("bash", {
      args: [
        "-c",
        'export PATH="$PWD/bin:$PATH"; chmod +x bin/gh board/scripts/github/*.sh\n' +
        `GH_FAIL=${fail} board/scripts/github/view.sh 12`,
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return { code: r.code, out: new TextDecoder().decode(r.stdout) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("an issue with no comments prints its fields and body", async () => {
  const { code, out } = await view("");
  assertEquals(code, 0);
  assertStringIncludes(out, "title:\tA title\n");
  assertStringIncludes(out, "state:\tOPEN\n");
  assertStringIncludes(out, "parent:\t#7\n");
  assertStringIncludes(out, "The body.\n");
});

Deno.test("comments follow the body", async () => {
  const { code, out } = await view("author:\tsomeone\n--\nA comment.\n--\n");
  assertEquals(code, 0);
  assert(out.indexOf("The body.") < out.indexOf("A comment."), out);
  assert(out.includes("A comment."), out);
});

// One shape on every backend: the phases read this line the same way on each.
const hexOf = (value: unknown) =>
  Array.from(new TextEncoder().encode(JSON.stringify(value)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const CREATED = /^created:\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

Deno.test("the first line is GitHub's creation time, ahead of any issue text", async () => {
  const { out } = await view("");
  assertEquals(out.split("\n")[0], "created:\t2026-01-02T03:04:05Z");
  assert(CREATED.test(out.split("\n")[0]), out);
});

Deno.test("cloud: the first line is the API's creation time, to the second", async () => {
  await withServer(async (port) => {
    const { code, out } = await run("view.sh", ["1"], `http://127.0.0.1:${port}/ok`);
    assertEquals(code, 0, out);
    assertEquals(out.split("\n")[0], "created:\t2026-01-02T03:04:05Z");
    assert(CREATED.test(out.split("\n")[0]), out);
    assertStringIncludes(out.split("\n")[1], "#1  t");
  });
});

Deno.test("cloud: a value in whole seconds passes unchanged", async () => {
  await withServer(async (port) => {
    const value = hexOf("2026-01-02T03:04:05Z");
    const url = `http://127.0.0.1:${port}/created/${value}`;
    const { out } = await run("view.sh", ["1"], url);
    assertEquals(out.split("\n")[0], "created:\t2026-01-02T03:04:05Z");
  });
});

Deno.test("cloud: a created line in the task's own text comes after the real one", async () => {
  await withServer(async (port) => {
    const value = hexOf("2026-01-02T03:04:05.1Z");
    const url = `http://127.0.0.1:${port}/created/${value}`;
    const { code, out } = await run("view.sh", ["1"], url);
    assertEquals(code, 0, out);
    const lines = out.split("\n");
    assertEquals(lines[0], "created:\t2026-01-02T03:04:05Z");
    assert(lines.indexOf("created:\t2000-01-01T00:00:00Z") > 0, out);
  });
});

Deno.test("cloud: a response without the field prints a dash, and still succeeds", async () => {
  await withServer(async (port) => {
    const url = `http://127.0.0.1:${port}/nocreated`;
    const { code, out } = await run("view.sh", ["1"], url);
    assertEquals(code, 0, out);
    assertEquals(out.split("\n")[0], "created:\t—");
    assertStringIncludes(out, "#1  t");
  });
});

// Each of these would reach a command line a phase composes.
const REFUSED_VALUES: unknown[] = [
  "$(touch x)",
  "`touch x`",
  "2026-01-02T03:04:05Z; id",
  "2026-01-02T03:04:05;1Z",
  "٢٠٢٦-٠١-٠٢T٠٣:٠٤:٠٥Z",
  "2026-01-02T03:04:05Z\n--flag",
  "--2026-01-02T03:04:05Z",
  "2026-01-02 03:04:05",
  "2026-01-02T03:04:05+01:00",
  "",
  1767322800,
  { a: 1 },
  false,
  null,
];
for (const bad of REFUSED_VALUES) {
  Deno.test(`cloud: createdAt ${JSON.stringify(bad)} prints a dash`, async () => {
    await withServer(async (port) => {
      const value = hexOf(bad);
      const url = `http://127.0.0.1:${port}/created/${value}`;
      const { code, out } = await run("view.sh", ["1"], url);
      assertEquals(code, 0, out);
      assertEquals(out.split("\n")[0], "created:\t—");
    });
  });
}

for (const call of ["json", "plain", "comments"]) {
  Deno.test(`a failing ${call} call fails the script`, async () => {
    const { code } = await view("", call);
    assertEquals(code, 1);
  });
}
