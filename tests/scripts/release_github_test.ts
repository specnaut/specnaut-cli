// Behaviour tests for the bundled `release-github.sh`, against a stubbed `gh`.
//
// Until these existed the only coverage was `smoke-tag-release.sh`'s `#228`
// checks, which grep the script for strings: "gh release list" is present,
// "already exists" is present. Every defect below passes those greps, because
// each one is in what the script DOES with the answer, not in whether it asks.
//
// The stub keeps a tiny release store on disk (one file per tag holding
// `draft` or `published`) and honours the flags the script depends on —
// notably `--exclude-drafts`, which is the whole of #607. It hands `--jq`
// expressions to the real `jq`, so the script's own filters are exercised
// rather than re-implemented here.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/skills/ship/scripts/", import.meta.url));

const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
STORE="$GH_STUB_STORE"
jqflag=""; jqexpr=""; jsonflag=""; draft=false; excl=false; args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --jq) jqexpr="$2"; shift 2 ;;
    --json) jsonflag="$2"; shift 2 ;;
    --draft) draft=true; shift ;;
    --exclude-drafts) excl=true; shift ;;
    --limit|--title|--notes-file) shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
out() {
  if [ -n "$jqexpr" ]; then jq -r "$jqexpr"; else cat; fi \
    | if [ -n "\${GH_STUB_CRLF:-}" ]; then sed 's/$/\r/'; else cat; fi
}
case "\${args[0]} \${args[1]:-}" in
  "auth status") exit 0 ;;
  "release view")
    t="\${args[2]}"; [ -f "$STORE/$t" ] || exit 1
    d=false; [ "$(cat "$STORE/$t")" = draft ] && d=true
    printf '{"isDraft":%s,"url":"https://example.invalid/releases/%s"}' "$d" "$t" | out ;;
  "release list")
    items=""
    for f in "$STORE"/*; do
      [ -f "$f" ] || continue
      t=$(basename "$f"); d=false; [ "$(cat "$f")" = draft ] && d=true
      [ "$excl" = true ] && [ "$d" = true ] && continue
      items="$items{\\"tagName\\":\\"$t\\",\\"isDraft\\":$d},"
    done
    printf '[%s]' "\${items%,}" | out ;;
  "release create")
    t="\${args[2]}"; cat > "$STORE/body-$t"
    if [ "$draft" = true ]; then echo draft > "$STORE/$t"; else echo published > "$STORE/$t"; fi
    echo "https://example.invalid/releases/$t" ;;
  *) echo "gh stub: unhandled: $*" >&2; exit 99 ;;
esac
`;

type Result = { code: number; stdout: string; stderr: string; body: (tag: string) => string };

/**
 * A repo with tags v1.0.0 → v1.1.0 → v1.2.0 → v1.3.0 (one commit each), an
 * origin that already has them, and a release store seeded by `releases`.
 */
async function withRepo(
  releases: Record<string, "draft" | "published">,
  args: string[],
  fn: (r: Result) => void | Promise<void>,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "release-github-" });
  try {
    const repo = join(root, "repo");
    const origin = join(root, "origin.git");
    const bin = join(root, "bin");
    const store = join(root, "store");
    const scripts = join(root, "scripts");
    for (const d of [repo, bin, store, scripts]) await Deno.mkdir(d, { recursive: true });

    for (const s of ["release-github.sh", "release.sh"]) {
      await Deno.copyFile(join(SCRIPTS, s), join(scripts, s));
    }
    await Deno.writeTextFile(join(bin, "gh"), GH_STUB);
    await Deno.chmod(join(bin, "gh"), 0o755);
    for (const [tag, state] of Object.entries(releases)) {
      await Deno.writeTextFile(join(store, tag), `${state}\n`);
    }

    const git = async (...a: string[]) => {
      const r = await new Deno.Command("git", {
        args: a,
        cwd: repo,
        stdout: "null",
        stderr: "piped",
      })
        .output();
      assert(r.success, `git ${a.join(" ")}: ${new TextDecoder().decode(r.stderr)}`);
    };
    await new Deno.Command("git", { args: ["init", "-q", "--bare", origin] }).output();
    await git("init", "-q");
    await git("config", "user.email", "t@example.invalid");
    await git("config", "user.name", "t");
    await git("remote", "add", "origin", origin);
    let n = 0;
    for (const tag of ["v1.0.0", "v1.1.0", "v1.2.0", "v1.3.0"]) {
      await Deno.writeTextFile(join(repo, "f.txt"), `${n++}\n`);
      await git("add", "f.txt");
      await git("commit", "-qm", `feat: change ${tag}`);
      // Distinct creator dates: the script orders tags by -creatordate.
      await new Deno.Command("git", {
        args: ["tag", "-a", tag, "-m", tag],
        cwd: repo,
        env: { GIT_COMMITTER_DATE: `2026-01-0${n} 12:00:00 +0000` },
      }).output();
    }
    await git("push", "-q", "origin", "HEAD:refs/heads/main", "--tags");

    const r = await new Deno.Command("bash", {
      args: [join(scripts, "release-github.sh"), ...args],
      cwd: repo,
      env: { PATH: `${bin}:${Deno.env.get("PATH")}`, GH_STUB_STORE: store, ...extraEnv },
      stdout: "piped",
      stderr: "piped",
    }).output();
    await fn({
      code: r.code,
      stdout: new TextDecoder().decode(r.stdout),
      stderr: new TextDecoder().decode(r.stderr),
      body: (tag) => Deno.readTextFileSync(join(store, `body-${tag}`)),
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

// ---------------------------------------------------------------- #607

Deno.test("release-github: a draft on an older tag is not the deployed baseline (#607)", async () => {
  // v1.0.0 published, v1.2.0 a stray draft. Releasing v1.3.0 must reach back
  // to v1.0.0 and report v1.2.0 and v1.1.0 as subsumed. Counting the draft
  // stops the walk at v1.2.0 and silently drops v1.1.0/v1.2.0's commits.
  await withRepo({ "v1.0.0": "published", "v1.2.0": "draft" }, ["v1.3.0"], (r) => {
    assertEquals(r.code, 0, r.stderr);
    const body = r.body("v1.3.0");
    assertStringIncludes(body, "subsumes undeployed tags: `v1.2.0`, `v1.1.0`");
    assertStringIncludes(body, "feat: change v1.1.0");
  });
});

Deno.test("release-github: a CRLF-terminated tag list still finds the baseline", async () => {
  // A Windows `jq` ends lines with CRLF. Left in, the carriage return makes
  // every published tag read as `v1.0.0\r`, nothing matches, and the walk runs
  // past the real baseline to the first tag — the same silent wrong range as
  // counting a draft. First seen on the windows-latest runner.
  await withRepo(
    { "v1.0.0": "published", "v1.2.0": "draft" },
    ["v1.3.0"],
    (r) => {
      assertEquals(r.code, 0, r.stderr);
      const body = r.body("v1.3.0");
      assertStringIncludes(body, "subsumes undeployed tags: `v1.2.0`, `v1.1.0`.");
    },
    { GH_STUB_CRLF: "1" },
  );
});

// ---------------------------------------------------------------- #608

Deno.test("release-github: --draft never reports a publish (#608)", async () => {
  await withRepo({ "v1.0.0": "published" }, ["--draft", "v1.3.0"], (r) => {
    assertEquals(r.code, 0, r.stderr);
    assert(
      !r.stdout.includes("published release"),
      `a draft was reported as published:\n${r.stdout}`,
    );
    assertStringIncludes(
      r.stdout,
      "✓ draft release created (not published): https://example.invalid/releases/v1.3.0",
    );
  });
});

Deno.test("release-github: a real publish still says published (#608)", async () => {
  await withRepo({ "v1.0.0": "published" }, ["v1.3.0"], (r) => {
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "✓ published release: https://example.invalid/releases/v1.3.0");
  });
});

// ---------------------------------------------------------------- #609

Deno.test("release-github: re-run on an existing DRAFT states that it is a draft (#609)", async () => {
  await withRepo({ "v1.0.0": "published", "v1.3.0": "draft" }, ["v1.3.0"], (r) => {
    assertEquals(r.code, 0, "idempotency is kept: adopting is not an error by default");
    assertStringIncludes(r.stdout, "exists draft=true url=https://example.invalid/releases/v1.3.0");
  });
});

Deno.test("release-github: re-run on an existing PUBLISHED release states that (#609)", async () => {
  await withRepo({ "v1.0.0": "published", "v1.3.0": "published" }, ["v1.3.0"], (r) => {
    assertEquals(r.code, 0);
    assertStringIncludes(
      r.stdout,
      "exists draft=false url=https://example.invalid/releases/v1.3.0",
    );
  });
});

Deno.test("release-github: --fail-if-exists refuses to adopt, with its own exit code (#609)", async () => {
  await withRepo({ "v1.3.0": "published" }, ["--fail-if-exists", "v1.3.0"], (r) => {
    assertEquals(
      r.code,
      3,
      `expected the reserved "already existed" code:\n${r.stdout}${r.stderr}`,
    );
    assertStringIncludes(r.stdout, "exists draft=false");
  });
});

Deno.test("release-github: a fresh release reports its state machine-readably too (#609)", async () => {
  // The caller must be able to tell "just created" from "already existed"
  // without parsing prose — the adopted path says `exists`, this one `created`.
  await withRepo({ "v1.0.0": "published" }, ["--draft", "v1.3.0"], (r) => {
    assertStringIncludes(
      r.stdout,
      "created draft=true url=https://example.invalid/releases/v1.3.0",
    );
  });
});
