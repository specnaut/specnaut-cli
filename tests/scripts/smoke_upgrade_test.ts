import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * cli#670 — `smoke-upgrade.sh` upgrades a project made by the previous release
 * with the published binary. These tests drive it offline: `SMOKE_RELEASES`
 * stands in for the Releases API, a fake installer drops a fake previous
 * binary, and a fake published binary does what a correct `upgrade` does unless
 * a case breaks one thing. Every assertion the script makes is observed red
 * here against the binary that breaks it, and every way the previous project
 * can fail to be PREPARED is observed to exit 4 — never 1, which postflight
 * reads as a broken release.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}.specnaut/release/smoke-upgrade.sh`;
const POSTFLIGHT = `${ROOT}.specnaut/release/postflight.sh`;
const KEPT = ".claude/skills/retired-smoke/SKILL.md";
const LINK = ".claude/CLAUDE.md";
// smoke-upgrade.sh is the release operator's script, run from a macOS or Linux
// shell. Its fake upgrade makes `.claude/CLAUDE.md` with `ln -s`, which Git
// Bash on Windows turns into a copy, so the cases that run it skip Windows.
const ignore = Deno.build.os === "windows";
const HEADING = "  preserved by declaration — upstream no longer ships this path";

// Published stable releases only, as the API filters them.
const RELEASES = ["v1.0.0", "v1.1.0", "v1.2.0", "v2.0.0"];

type Broken = {
  exitCode?: number;
  deleteKept?: boolean;
  dropKept?: boolean;
  silentOnSecond?: boolean;
  reportsOtherPath?: boolean;
  touchForeign?: boolean;
  staleVersion?: boolean;
  /** Leaves the previous release's regular `.claude/CLAUDE.md` in place. */
  linkAsFile?: boolean;
  /** Links `.claude/CLAUDE.md` with this text instead of `../AGENTS.md`. */
  linkTo?: string;
  /** Turns the link back into a regular file on the second run only. */
  fileOnSecond?: boolean;
  /** Deletes `.claude/CLAUDE.md` and writes nothing in its place. */
  removeLink?: boolean;
};

type Setup = { installFails?: boolean; initFails?: boolean; entriesNotLast?: boolean };

/** The binary `upgrade` runs, correct unless `b` says which part to break. */
function publishedBinary(want: string, b: Broken, seen: string): string {
  const report = `echo "${HEADING}"; echo "    ⚠ ${b.reportsOtherPath ? "other/path.md" : KEPT}"`;
  return `#!/usr/bin/env bash
[ "$1" = upgrade ] || exit 64
echo "$HOME" > "${seen}"
n=$(( $(cat .runs 2>/dev/null || echo 0) + 1 )); echo $n > .runs
[ "$n" -eq 1 ] && { [ -L ${LINK} ] && echo "a link" || cat ${LINK}; } > "${seen}-link"
lock=.specnaut/installed.lock
${
    b.staleVersion
      ? ""
      : `sed 's/^templates_version: .*/templates_version: ${want}/' $lock > l && mv l $lock`
  }
${b.deleteKept ? `rm -f ${KEPT}` : ""}
${
    b.dropKept
      ? `awk '/retired-smoke\\/SKILL.md:/{s=4} s>0{s--;next} {print}' $lock > l && mv l $lock`
      : ""
  }
${b.touchForeign ? "echo '// edited' >> src/app.ts" : ""}
${b.linkAsFile ? "" : `rm -f ${LINK}; ln -s ${b.linkTo ?? "../AGENTS.md"} ${LINK}`}
${b.removeLink ? `rm -f ${LINK}` : ""}
${b.fileOnSecond ? `[ "$n" -eq 2 ] && { rm -f ${LINK}; echo stale > ${LINK}; }` : ""}
${b.silentOnSecond ? `[ "$n" -eq 1 ] && { ${report}; }` : report}
exit ${b.exitCode ?? 0}
`;
}

/** The installer: records what it was asked for and drops the previous binary. */
function installer(dir: string, s: Setup): string {
  const tail = s.entriesNotLast ? "harness: claude\\\\n" : "";
  return `#!/usr/bin/env bash
echo "$VERSION" >> "${dir}/installed-version"
${s.installFails ? "exit 1" : ""}
cat > "$PREFIX/specnaut" <<'BIN'
#!/usr/bin/env bash
[ "$1" = init ] || exit 64
${s.initFails ? "echo boom; exit 3" : ""}
mkdir -p .specnaut .claude
echo '# Agents' > AGENTS.md
echo '# Claude' > ${LINK}
printf 'version: 2\\ntemplates_version: 0.0.0\\nentries:\\n${tail}' > .specnaut/installed.lock
BIN
chmod +x "$PREFIX/specnaut"
`;
}

async function run(tag: string, b: Broken = {}, s: Setup = {}, releases = RELEASES) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-smoke-upgrade-" });
  try {
    const inst = join(dir, "install.sh");
    await Deno.writeTextFile(inst, installer(dir, s));
    const bin = join(dir, "published-specnaut");
    await Deno.writeTextFile(bin, publishedBinary(tag.slice(1), b, join(dir, "seen-home")));
    await Deno.chmod(bin, 0o755);
    const out = await new Deno.Command("bash", {
      args: [SCRIPT, tag, bin],
      env: {
        SMOKE_RELEASES: releases.join("\n"),
        SMOKE_INSTALLER: inst,
        SMOKE_RETRY_DELAY: "0",
      },
    }).output();
    const read = (f: string) => Deno.readTextFile(join(dir, f)).then((t) => t.trim(), () => "");
    const dec = new TextDecoder();
    return {
      code: out.code,
      out: dec.decode(out.stdout) + dec.decode(out.stderr),
      installed: await read("installed-version"),
      home: await read("seen-home"),
      linkBefore: await read("seen-home-link"),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test(
  "passes when both upgrades keep, track and report the declared file",
  { ignore },
  async () => {
    const r = await run("v1.2.0");
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "✓ the binary upgrades a v1.1.0 project twice");
    assertStringIncludes(r.out, `${LINK} linked to ../AGENTS.md`);
  },
);

Deno.test("hands the first upgrade a link checked out as a file, so the relink is what is tested", {
  ignore,
}, async () => {
  // A release that already scaffolds the link would otherwise only show that
  // upgrade leaves a link alone, never that it makes one.
  assertEquals((await run("v1.2.0")).linkBefore, "../AGENTS.md");
});

Deno.test("installs the highest published release below the tag", { ignore }, async () => {
  assertEquals((await run("v1.2.0")).installed, "v1.1.0");
  // A prerelease being published, or a hotfix on an older line, too.
  assertEquals((await run("v1.2.1-rc.1")).installed, "v1.2.0");
  assertEquals((await run("v1.1.1")).installed, "v1.1.0");
});

Deno.test("skips, with exit 3 and the reason, when no release was published before the tag", {
  ignore,
}, async () => {
  const r = await run("v1.0.0");
  assertEquals(r.code, 3, r.out);
  assertStringIncludes(r.out, "skipped — no release was published before v1.0.0");
  assertEquals(r.installed, "", "a skip must not install anything");
});

Deno.test("runs the published binary with a home of its own", { ignore }, async () => {
  const r = await run("v1.2.0");
  assert(r.home !== "" && r.home !== Deno.env.get("HOME"), `upgrade saw HOME=${r.home}`);
});

for (
  const [name, setup, says] of [
    [
      "the install fails, after three attempts",
      { installFails: true },
      "could not install v1.1.0 (3 attempts)",
    ],
    [
      "the previous release's init fails",
      { initFails: true },
      "`specnaut init` of v1.1.0 exited non-zero",
    ],
    [
      "the previous lock does not end with its entries",
      { entriesNotLast: true },
      "does not end with its entries",
    ],
  ] as Array<[string, Setup, string]>
) {
  Deno.test(`exits 4, not 1, when ${name}`, { ignore }, async () => {
    const r = await run("v1.2.0", {}, setup);
    assertEquals(r.code, 4, r.out);
    assertStringIncludes(r.out, says);
  });
}

Deno.test("retries the install three times before giving up", { ignore }, async () => {
  const r = await run("v1.2.0", {}, { installFails: true });
  assertEquals(r.installed.split("\n"), ["v1.1.0", "v1.1.0", "v1.1.0"]);
});

for (
  const [name, broken, says] of [
    ["exits non-zero", { exitCode: 1 }, "the first `specnaut upgrade` from v1.1.0 exited non-zero"],
    ["deletes the declared file", { deleteKept: true }, "the first upgrade deleted"],
    ["drops the declared file from the lock", { dropKept: true }, "dropped .claude/skills/"],
    [
      "goes silent on the second run",
      { silentOnSecond: true },
      "the second upgrade did not report",
    ],
    ["reports another path under the heading", { reportsOtherPath: true }, "did not report"],
    ["changes the file outside Specnaut's folders", { touchForeign: true }, "changed src/app.ts"],
    [
      "leaves .claude/CLAUDE.md a regular file",
      { linkAsFile: true },
      `the first upgrade left ${LINK} a regular file, not a link to ../AGENTS.md`,
    ],
    [
      "links .claude/CLAUDE.md to another path",
      { linkTo: "AGENTS.md" },
      `the first upgrade linked ${LINK} to 'AGENTS.md', expected ../AGENTS.md`,
    ],
    [
      "deletes .claude/CLAUDE.md",
      { removeLink: true },
      `the first upgrade left no ${LINK}, expected a link to ../AGENTS.md`,
    ],
    [
      "turns the link back into a file on the second run",
      { fileOnSecond: true },
      `the second upgrade left ${LINK} a regular file`,
    ],
    [
      "leaves the lock at another release",
      { staleVersion: true },
      "templates 0.0.0, expected 1.2.0",
    ],
  ] as Array<[string, Broken, string]>
) {
  Deno.test(`fails when the published upgrade ${name}`, { ignore }, async () => {
    const r = await run("v1.2.0", broken);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, says);
  });
}

Deno.test(
  "a failure across a major version says to read the notes before retracting",
  { ignore },
  async () => {
    const cross = await run("v2.0.0", { deleteKept: true });
    assertEquals(cross.code, 1, cross.out);
    assertStringIncludes(cross.out, "crosses a major version (v1.2.0 → v2.0.0)");
    const same = await run("v1.2.0", { deleteKept: true });
    assert(!same.out.includes("crosses a major version"), same.out);
  },
);

Deno.test("postflight fails hard on 1, and reports a skip or an unprepared project as a skip", async () => {
  const src = await Deno.readTextFile(POSTFLIGHT);
  const init = src.indexOf('bash .specnaut/release/smoke-published.sh "$TAG"');
  const call = src.indexOf('bash .specnaut/release/smoke-upgrade.sh "$TAG"');
  assert(init > 0 && call > init, "postflight must run smoke-upgrade.sh after smoke-published.sh");
  const exit = src.indexOf("exit 1", call);
  assert(exit > call && exit - call < 600, "a failed upgrade smoke must exit 1");
  for (const rc of ['"$upgradesmoke_rc" -eq 3', '"$upgradesmoke_rc" -eq 4']) {
    const at = src.indexOf(rc, call);
    assert(at > call && at < exit, `${rc} must be handled before the hard failure`);
  }
  assertStringIncludes(src, "upgrade from the previous release NOT smoke-tested");
});
