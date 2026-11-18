import { assertEquals } from "@std/assert";
import { PLAIN_URL } from "../../src/infrastructure/browser_opener.ts";
import {
  readCalls,
  type Run,
  runScript,
  scriptSource,
  stub,
  toolsOnlyPath,
} from "./backend_scripts_fixture.ts";

/**
 * `_open_url.sh` opens the board with the rules of the CLI's own opener
 * (`browser_opener.ts`, cli#803): only a plain http(s) URL, as one argument,
 * through the launcher the OS implies. Every launcher and `uname` are
 * stand-ins logging their argv, one argument a line.
 */

const URL_ = "https://github.com/orgs/acme/projects/7";

/** Logs `<name>`, each argument on its own line, and the MSYS settings, to `<tmp>/calls`. */
const LOGGED = [
  'log="$(dirname "$0")/../calls"',
  'echo "$(basename "$0") MSYS_NO_PATHCONV=${MSYS_NO_PATHCONV:-} MSYS2_ARG_CONV_EXCL=${MSYS2_ARG_CONV_EXCL:-}" >>"$log"',
  'for a in "$@"; do printf "  %s\\n" "$a" >>"$log"; done',
].join("\n");

const LAUNCHERS = { open: LOGGED, "xdg-open": LOGGED, rundll32: LOGGED };

/**
 * A project whose `uname -s` says `os` (null: the real one), its launchers
 * stood in for, then `body` after sourcing. `$U` in `body` is `url`, read from
 * a file so that no text of it is ever shell code.
 */
async function probe(
  os: string | null,
  body: string,
  opts: { url?: string; launchers?: Record<string, string>; path?: string } = {},
): Promise<Run & { calls: string }> {
  const tmp = await Deno.makeTempDir({ prefix: "open-url-" });
  await Deno.mkdir(`${tmp}/bin`);
  if (os !== null) await stub(tmp, "uname", `echo ${os}`);
  for (const [name, script] of Object.entries(opts.launchers ?? LAUNCHERS)) {
    await stub(tmp, name, script);
  }
  await Deno.writeTextFile(`${tmp}/url`, opts.url ?? URL_);
  body = `U=$(cat "$(dirname "$0")/url"; printf .); U=\${U%.}\n${body}`;
  await Deno.copyFile(scriptSource("_open_url.sh"), `${tmp}/_open_url.sh`);
  await Deno.writeTextFile(
    `${tmp}/probe.sh`,
    `#!/usr/bin/env bash\nset -euo pipefail\n. "$(dirname "$0")/_open_url.sh"\n${body}\n`,
  );
  const run = await runScript(tmp, `${tmp}/probe.sh`, [], opts.path);
  return { ...run, calls: await readCalls(`${tmp}/calls`) };
}

Deno.test("each OS gets its launcher, the URL one argument", async () => {
  const none = "MSYS_NO_PATHCONV= MSYS2_ARG_CONV_EXCL=";
  const cases: Array<[string, string, string]> = [
    ["Darwin", "OPEN: open", `open ${none}\n  ${URL_}\n`],
    ["Linux", "OPEN: xdg-open", `xdg-open ${none}\n  ${URL_}\n`],
    ["FreeBSD", "OPEN: xdg-open", `xdg-open ${none}\n  ${URL_}\n`],
  ];
  const windows =
    `rundll32 MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL=*\n  url.dll,FileProtocolHandler\n  ${URL_}\n`;
  for (const os of ["MINGW64_NT-10.0-19045", "MSYS_NT-10.0", "CYGWIN_NT-10.0"]) {
    cases.push([os, "OPEN: rundll32", windows]);
  }
  for (const [os, says, calls] of cases) {
    const r = await probe(os, 'open_url "$U"');
    assertEquals([r.code, r.out, r.calls], [0, says, calls], `${os}: ${r.err}`);
  }
});

Deno.test("anything but a plain http(s) URL is skipped, and no launcher runs", async () => {
  for (
    const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://example.com/x",
      "https://example.com/a b",
      'https://example.com/a"b',
      "https://example.com/$(touch pwned)",
      "https://example.com/a\nhttps://example.com/b",
      "https://example.com/a\r",
      "",
    ]
  ) {
    const r = await probe("Darwin", 'open_url "$U"', { url });
    assertEquals([r.code, r.out, r.calls], [0, "OPEN: skipped - not a plain http(s) URL", ""], url);
  }
});

Deno.test("a launcher that fails is skipped, exit 0", async () => {
  const launchers = { open: `${LOGGED}\nexit 3` };
  const r = await probe("Darwin", 'open_url "$U"', { launchers });
  assertEquals([r.code, r.out], [0, "OPEN: skipped - open failed"], r.err);
  assertEquals(r.calls, `open MSYS_NO_PATHCONV= MSYS2_ARG_CONV_EXCL=\n  ${URL_}\n`);
});

Deno.test({
  name: "a missing launcher is skipped, exit 0",
  // A PATH of links to the tools the helper runs; Windows links need a privilege.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const tools = await toolsOnlyPath(["bash", "grep", "dirname", "cat"]);
    const r = await probe("Linux", 'open_url "$U"', { launchers: {}, path: tools });
    assertEquals([r.code, r.out, r.calls], [0, "OPEN: skipped - xdg-open not found", ""], r.err);
  },
});

Deno.test("the shell's plain-URL rule is browser_opener.ts's PLAIN_URL, character for character", async () => {
  const urls = ["http://a.example/", "https://a.example/", "HTTPS://a.example/", "https:/a"];
  for (let c = 0x20; c < 0x7f; c++) urls.push(`https://a.example/${String.fromCharCode(c)}`);
  for (const c of ["é", "\t", " "]) urls.push(`https://a.example/${c}`);
  const list = await Deno.makeTempFile();
  await Deno.writeTextFile(list, urls.join("\n") + "\n");
  const r = await probe(
    "Darwin",
    `while IFS= read -r u; do open_url "$u" | sed 's/^OPEN: skipped.*/0/; s/^OPEN: open$/1/'; done <'${list}'`,
  );
  assertEquals(r.out.split("\n"), urls.map((u) => (PLAIN_URL.test(u) ? "1" : "0")), r.err);
});

Deno.test("unstubbed, the launcher is the one Deno.build.os implies", async () => {
  const want = { darwin: "open", windows: "rundll32" }[Deno.build.os as string] ?? "xdg-open";
  const r = await probe(null, "open_launcher", { launchers: {} });
  assertEquals([r.code, r.out], [0, want], r.err);
});
