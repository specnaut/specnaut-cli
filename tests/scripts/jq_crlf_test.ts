// cli#701: a native Windows jq.exe writes stdout in text mode, every \n as
// \r\n, so a value captured with `$(jq -r …)` kept a \r — a feature directory
// that opens nothing, an id the tracker does not know. Each script family (the
// spec scripts, and each board backend, installed alone) reads jq through one
// helper, `jq_lf`, defined in the file the whole family sources.
//
// Every case runs under a `jq` on PATH that rewrites each line ending to CRLF,
// as jq.exe does, and asserts on the value the shell captured. The sweep at the
// end holds every jq call of both families to the helper, so a call added
// later without it fails here rather than on a Windows user's machine.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

const TEMPLATES = fromFileUrl(new URL("../../templates/core/", import.meta.url));
const SPEC = join(TEMPLATES, "specnaut/scripts/bash");
const SPEC_FILES = ["common.sh", "_git_probe.sh", "_feature_json.sh", "template-resolution.sh"];
const BOARD = join(TEMPLATES, "skills/task/scripts");
const BACKENDS = ["cloud", "github", "gitlab", "local"] as const;

/** What each backend's `_config.sh` needs before it will source. */
const CONFIG: Record<string, string | undefined> = {
  cloud: 'api_url: "https://api.example.com"\nproject_key: "ACME"\n',
  github: 'repo: "acme/my-app"\nproject_number: 7\n',
  gitlab: 'host: "https://gitlab.example.com"\nproject_id: "acme/my-app"\n',
  local: undefined,
};

type Run = { code: number; stdout: string; stderr: string };

async function bash(args: string[], env: Record<string, string>, stdin = ""): Promise<Run> {
  const child = new Deno.Command("bash", {
    args,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(stdin));
  await w.close();
  const out = await child.output();
  const d = new TextDecoder();
  return { code: out.code, stdout: d.decode(out.stdout), stderr: d.decode(out.stderr) };
}

/**
 * A throwaway root with `bin/jq` first on PATH: the real jq with a \r added
 * before every \n, a last line without one left alone — what jq.exe writes.
 * On a runner whose jq already is jq.exe, the wrapper adds nothing: doubled,
 * the \r\n would be one no jq writes.
 */
async function crlfRoot(): Promise<{ root: string; env: Record<string, string> }> {
  const root = await Deno.makeTempDir({ prefix: "jq-crlf-" });
  const real = (await bash(["-c", "command -v jq"], {})).stdout.trim();
  assert(real, "jq is not on PATH");
  const native = (await bash(["-c", `'${real}' -n 1`], {})).stdout.endsWith("\r\n");
  await Deno.mkdir(join(root, "bin"));
  await Deno.writeTextFile(
    join(root, "bin", "jq"),
    native ? `#!/usr/bin/env bash\nexec '${real}' "$@"\n` : `#!/usr/bin/env bash
'${real}' "$@" | { while IFS= read -r l; do printf '%s\\r\\n' "$l"; done; printf '%s' "$l"; }
exit "\${PIPESTATUS[0]}"
`,
  );
  await Deno.writeTextFile(
    join(root, "bin", "specnaut"),
    "#!/usr/bin/env bash\necho token-for-test\n",
  );
  await Deno.chmod(join(root, "bin", "jq"), 0o755);
  await Deno.chmod(join(root, "bin", "specnaut"), 0o755);
  const sep = Deno.build.os === "windows" ? ";" : ":";
  return { root, env: { PATH: `${join(root, "bin")}${sep}${Deno.env.get("PATH")}` } };
}

/** Installs a family's shared file where a project has it; returns the driver's path. */
async function install(root: string, family: string): Promise<string> {
  const spec = family === "spec";
  const dir = join(root, spec ? ".specnaut/scripts/bash" : ".specnaut/scripts/backlog");
  await Deno.mkdir(dir, { recursive: true });
  const shared = spec ? "common.sh" : "_config.sh";
  // A backend's `_config.sh` sources the shared character rule beside it.
  for (const f of spec ? SPEC_FILES : [shared, "../_issue_text.sh"]) {
    await Deno.copyFile(join(spec ? SPEC : join(BOARD, family), f), join(dir, basename(f)));
  }
  const config = CONFIG[family];
  if (config) await Deno.writeTextFile(join(root, ".specnaut/backlog-config.yml"), config);
  // Each value framed in <…>, so a trailing \r is visible to the assertion.
  await Deno.writeTextFile(
    join(dir, "driver.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/${shared}"
one=$(printf '%s' '{"v":"ACME-7"}' | jq_lf -r .v)
many=$(jq_lf -r '.[]' <<<'["a","b"]')
count=$(jq_lf 'length' <<<'[1,2,3]')
kept=$(jq_lf -r .v <<<'{"v":"keep\\r\\nit\\r"}')
rc=0; jq_lf -e .missing <<<'{}' >/dev/null || rc=$?
printf '<%s>' "$one" "$many" "$count" "$kept" "$rc"
`,
  );
  return bashPath(join(dir, "driver.sh"));
}

// A \r the value carries itself survives, \r\n included; jq's exit status is jq's.
// Except at the very end on Windows: Git Bash's own `$(…)` drops a trailing
// \r with the \n, whatever jq_lf printed — the shell's, not the helper's.
const VALUES = Deno.build.os === "windows"
  ? "<ACME-7><a\nb><3><keep\r\nit><1>"
  : "<ACME-7><a\nb><3><keep\r\nit\r><1>";

for (const family of ["spec", ...BACKENDS]) {
  Deno.test(`jq_lf (${family}): values read under a CRLF jq carry no \\r`, async () => {
    const { root, env } = await crlfRoot();
    const r = await bash([await install(root, family)], env);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout, VALUES);
  });

  // Undone only where measured: under the jq on PATH, which on a POSIX runner
  // writes \n, the \r\n inside a value is the value's own.
  Deno.test(`jq_lf (${family}): under the runner's own jq, values are jq's`, async () => {
    const root = await Deno.makeTempDir({ prefix: "jq-lf-" });
    await Deno.mkdir(join(root, "bin"));
    await Deno.writeTextFile(join(root, "bin", "specnaut"), "#!/usr/bin/env bash\necho t\n");
    await Deno.chmod(join(root, "bin", "specnaut"), 0o755);
    const sep = Deno.build.os === "windows" ? ";" : ":";
    const r = await bash([await install(root, family)], {
      PATH: `${join(root, "bin")}${sep}${Deno.env.get("PATH")}`,
    });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout, VALUES);
  });
}

Deno.test("spec scripts: the feature directory from feature.json carries no \\r", async () => {
  const { root, env } = await crlfRoot();
  await install(root, "spec");
  await Deno.writeTextFile(
    join(root, ".specnaut/feature.json"),
    '{"feature_directory": ".specnaut/specs/001-alpha"}\n',
  );
  const common = bashPath(join(root, ".specnaut/scripts/bash/common.sh"));
  const r = await bash(["-c", `cd "$1" && source "$2" && get_feature_paths`, "_", root, common], {
    ...env,
    GIT_CEILING_DIRECTORIES: bashPath(join(root, "..")),
  });
  assertEquals(r.code, 0, r.stderr);
  const line = r.stdout.split("\n").find((l) => l.startsWith("FEATURE_DIR="));
  assert(line, r.stdout);
  assert(!line.includes("\\r") && !line.includes("\r"), JSON.stringify(line));
  assert(line.endsWith("/.specnaut/specs/001-alpha"), line);
});

Deno.test("spec scripts: groom-rules.sh prints its verdict without a \\r", async () => {
  const { env } = await crlfRoot();
  const record = { item: "42", body: "", sizes: [], priorities: ["P1"], status: "Ready" };
  const r = await bash(
    [bashPath(join(SPEC, "groom-rules.sh"))],
    env,
    JSON.stringify({ ...record, comments: [], state: "open", closed_reason: "" }) + "\n",
  );
  assertEquals(r.code, 1, r.stderr);
  assertStringIncludes(r.stdout, "#42: missing ## Why");
  assert(!r.stdout.includes("\r"), JSON.stringify(r.stdout));
});

Deno.test("github: detect-fields.sh emits ids without a \\r", async () => {
  const { root, env } = await crlfRoot();
  await install(root, "github");
  const scripts = join(root, ".specnaut/scripts/backlog");
  await Deno.copyFile(join(BOARD, "github/detect-fields.sh"), join(scripts, "detect-fields.sh"));
  const fields = JSON.stringify({
    fields: [{
      id: "F_status",
      name: "Status",
      type: "ProjectV2SingleSelectField",
      options: [{ id: "opt_backlog", name: "Backlog" }],
    }],
  });
  await Deno.writeTextFile(
    join(root, "bin", "gh"),
    `#!/usr/bin/env bash
case "$1 $2" in
  "project field-list") echo '${fields}' ;;
  "project view") echo '{"id":"PVT_stub"}' ;;
  *) exit 1 ;;
esac
`,
  );
  await Deno.chmod(join(root, "bin", "gh"), 0o755);
  const r = await bash([bashPath(join(scripts, "detect-fields.sh"))], env);
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stdout, "STATUS_FIELD_ID=F_status\n");
  assertStringIncludes(r.stdout, "STATUS_OPT_BACKLOG=opt_backlog\n");
  assert(!r.stdout.includes("\r"), JSON.stringify(r.stdout));
});

// --- the sweep -----------------------------------------------------------------

async function familyScripts(): Promise<string[]> {
  const files: string[] = [];
  for (const dir of [SPEC, ...BACKENDS.map((b) => join(BOARD, b))]) {
    for await (const e of Deno.readDir(dir)) {
      if (e.name.endsWith(".sh")) files.push(join(dir, e.name));
    }
  }
  return files.sort();
}

/** The helper's own two jq calls, the only bare ones a family may hold. */
const HELPER_OWN = [/^case \$\(jq -n 1 2>\/dev\/null; printf \.\)/, /^_o=\$\(_r=0; jq "\$@"/];

Deno.test("every jq call in both families goes through jq_lf", async () => {
  const bare: string[] = [];
  for (const file of await familyScripts()) {
    (await Deno.readTextFile(file)).split("\n").forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("#") || HELPER_OWN.some((re) => re.test(code))) return;
      // `jq ` as a command word: not `--jq`, not `command -v jq`.
      for (const m of code.matchAll(/(?<=^|[\s(|])jq(?= )/g)) {
        if (/command -v $/.test(code.slice(0, m.index))) continue;
        if (code.slice(m.index).startsWith("jq is required")) continue; // a message
        bare.push(`${file.slice(TEMPLATES.length)}:${i + 1}: ${code}`);
      }
    });
  }
  assertEquals(bare, []);
});

Deno.test("every copy of jq_lf is the same text", async () => {
  const copies = [join(SPEC, "common.sh"), ...BACKENDS.map((b) => join(BOARD, b, "_config.sh"))];
  const bodies = await Promise.all(copies.map(async (f) => {
    // A Windows checkout may carry CRLF (core.autocrlf); compare the text, not its line ends.
    const text = (await Deno.readTextFile(f)).replaceAll("\r\n", "\n");
    const start = text.indexOf("# jq_lf <jq args…>");
    const end = text.indexOf("\n}\n", start);
    assert(start >= 0 && end > start, `no jq_lf in ${f}`);
    return text.slice(start, end).split("\n").map((l) => l.trim()).join("\n");
  }));
  for (const [i, body] of bodies.entries()) assertEquals(body, bodies[0], copies[i]);
});
