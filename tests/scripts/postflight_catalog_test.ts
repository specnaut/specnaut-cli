import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * Postflight's marketplace check, run against stubbed `gh` and `claude`.
 *
 * It is a soft check: a broken channel is reported and the script goes on to
 * the attestation and published-binary gates after it. Its first version piped
 * a rejecting validator through grep under `set -euo pipefail`, which ended the
 * whole script there — the soft warning became a hard stop that skipped the
 * hard gates. These tests run the block between the `catalog-check` markers
 * and require it to reach its end in every case.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

// postflight.sh is the release operator's script, run from a macOS or Linux
// shell; these tests replace PATH with the stubs and the Unix system
// directories so a real `claude` cannot leak in, which leaves Windows without
// bash. They run on the other two platforms.
const ignore = Deno.build.os === "windows";
const POSTFLIGHT = `${ROOT}.specnaut/release/postflight.sh`;
const TAG = "v5.1.0";

async function block(): Promise<string> {
  const src = (await Deno.readTextFile(POSTFLIGHT)).replaceAll("\r\n", "\n");
  const m = src.match(/# BEGIN catalog-check\n([\s\S]*?)# END catalog-check/);
  assert(m, "postflight.sh has no catalog-check block");
  return m[1];
}

const catalog = (ref: string, plugins: [string, string][]) =>
  JSON.stringify({
    name: "specnaut-marketplace",
    owner: { name: "o" },
    plugins: plugins.map(([name, path]) => ({ name, source: { path, ref } })),
  });

type World = {
  /** The published catalogs. */
  claudeCatalog: string;
  copilotCatalog: string;
  /** `path` → the version its plugin.json declares at the tag; absent = 404. */
  versions: Record<string, string>;
  /** Exit code of `claude plugin validate`; undefined = no claude on PATH. */
  validate?: number;
};

async function run(w: World): Promise<{ code: number; out: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-postflight-catalog-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    await Deno.writeTextFile(join(dir, "claude.json"), w.claudeCatalog);
    await Deno.writeTextFile(join(dir, "copilot.json"), w.copilotCatalog);
    const cases = Object.entries(w.versions)
      .map(([path, v]) =>
        `    *"/contents/${path}/.claude-plugin/plugin.json"*) echo '{"version":"${v}"}' ;;`
      )
      .join("\n");
    await Deno.writeTextFile(
      join(bin, "gh"),
      `#!/usr/bin/env bash
url="$2"
case "$url" in
  *specnaut-marketplace/contents/.claude-plugin/marketplace.json*) cat ${
        join(dir, "claude.json")
      } ;;
  *specnaut-marketplace/contents/.github/plugin/marketplace.json*) cat ${
        join(dir, "copilot.json")
      } ;;
${cases}
  *) echo "HTTP 404" >&2; exit 1 ;;
esac
`,
    );
    if (w.validate !== undefined) {
      await Deno.writeTextFile(
        join(bin, "claude"),
        `#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "9.9.9 (Claude Code)"; exit 0; }
[ ${w.validate} -eq 0 ] && { echo "✔ Validation passed"; exit 0; }
echo "  ❯ name: Invalid input"; echo "✘ Validation failed"; exit 1
`,
      );
      await Deno.chmod(join(bin, "claude"), 0o755);
    }
    await Deno.writeTextFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    await Deno.chmod(join(bin, "gh"), 0o755);
    await Deno.chmod(join(bin, "sleep"), 0o755);
    const script = `set -euo pipefail\nTAG=${TAG}\nREPO=specnaut/specnaut-cli\n${await block()}\n` +
      `echo "REACHED-END warned=$marketplace_warned"`;
    const sep = Deno.build.os === "windows" ? ";" : ":";
    // Only the stubs and the system tools: a real `claude` must not leak in.
    const out = await new Deno.Command("bash", {
      args: ["-c", script],
      cwd: ROOT,
      env: { PATH: `${bin}${sep}/usr/bin${sep}/bin${sep}/usr/local/bin${sep}/opt/homebrew/bin` },
    }).output();
    const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
    return { code: out.code, out: text };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const LOCAL_CLAUDE = JSON.parse(
  await Deno.readTextFile(`${ROOT}packaging/marketplace/.claude-plugin/marketplace.json`),
);
const LOCAL_COPILOT = JSON.parse(
  await Deno.readTextFile(`${ROOT}packaging/marketplace/.github/plugin/marketplace.json`),
);
const entries = (c: { plugins: { name: string; source: { path: string } }[] }) =>
  c.plugins.map((p) => [p.name, p.source.path] as [string, string]);
const allVersions = Object.fromEntries(
  [...entries(LOCAL_CLAUDE), ...entries(LOCAL_COPILOT)].map(([, path]) => [path, "5.1.0"]),
);

const healthy = (): World => ({
  claudeCatalog: catalog(TAG, entries(LOCAL_CLAUDE)),
  copilotCatalog: catalog(TAG, entries(LOCAL_COPILOT)),
  versions: allVersions,
  validate: 0,
});

Deno.test("a healthy channel passes without a warning", { ignore }, async () => {
  const r = await run(healthy());
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "REACHED-END warned=0");
  assertStringIncludes(r.out, "accepts the published catalog");
});

Deno.test(
  "a catalog Claude Code rejects is a warning, and the script goes on",
  { ignore },
  async () => {
    const r = await run({ ...healthy(), validate: 1 });
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "rejects the published catalog");
    assertStringIncludes(r.out, "❯ name: Invalid input");
    assertStringIncludes(r.out, "REACHED-END warned=1");
  },
);

Deno.test("an entry whose path does not resolve at the tag is a warning", { ignore }, async () => {
  const [first] = entries(LOCAL_CLAUDE);
  const versions = { ...allVersions };
  delete versions[first[1]];
  const r = await run({ ...healthy(), versions });
  assertStringIncludes(r.out, `${first[0]} does not resolve to 5.1.0`);
  assertStringIncludes(r.out, "REACHED-END warned=1");
});

Deno.test(
  "a published catalog that does not list what this release lists is a warning",
  { ignore },
  async () => {
    // Same paths, other names: a catalog from another release, or a hand edit.
    const stale = entries(LOCAL_CLAUDE).map(([name, path]) =>
      [`${name}-old`, path] as [string, string]
    );
    const r = await run({ ...healthy(), claudeCatalog: catalog(TAG, stale) });
    assertStringIncludes(r.out, ".claude-plugin catalog lists");
    assertStringIncludes(r.out, "REACHED-END warned=1");
  },
);

Deno.test("a catalog left on the previous tag is a warning", { ignore }, async () => {
  const r = await run({ ...healthy(), copilotCatalog: catalog("v5.0.1", entries(LOCAL_COPILOT)) });
  assertStringIncludes(r.out, "expected v5.1.0");
  assertStringIncludes(r.out, "REACHED-END warned=1");
});

Deno.test("no claude on PATH is said, not passed silently", { ignore }, async () => {
  const r = await run({ ...healthy(), validate: undefined });
  assertStringIncludes(r.out, "was NOT validated");
  assertStringIncludes(r.out, "REACHED-END warned=1");
});
