import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bashPath, type Run, type Sandbox, sandbox } from "../templates/hooks/hook_sandbox.ts";

/**
 * The real `report-upstream.sh` under a stubbed `gh`, first on PATH: no test here
 * reaches GitHub. HOME, the project directory and the git config are the
 * sandbox's, so a developer's own login or hostname never decides a case, and the
 * rules are read from the script (its header, its constants), never copied.
 */

export const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/report-upstream.sh", import.meta.url),
);

const WINDOWS = Deno.build.os === "windows";
const SEP = WINDOWS ? ";" : ":";

/** A constant the script declares at column 0, as the script spells it. */
export function constant(name: string): string {
  const m = new RegExp(`^${name}='?([^'\\n]+)'?$`, "m").exec(Deno.readTextFileSync(SCRIPT));
  if (!m) throw new Error(`report-upstream.sh declares no ${name}`);
  return m[1];
}

/**
 * The stdout grammar, compiled from the script's own header: the one home of what
 * it may print. `<sanitised>` and `<path>` may hold spaces; every other `<x>` is a
 * single word; `a|b` is either.
 */
export function grammar(): RegExp[] {
  const lines = Deno.readTextFileSync(SCRIPT).split("\n");
  const from = lines.findIndex((l) => l.startsWith("# Stdout is a closed grammar"));
  const rows: RegExp[] = [];
  for (const line of lines.slice(from + 1)) {
    if (!line.startsWith("#   ")) break;
    const parts = line.slice(4).split(" ").map((word) => {
      const alts = word.split("|").map((a) => {
        if (a === "<sanitised>" || a === "<path>") return ".+";
        return a.startsWith("<") ? "\\S+" : a.replace(/[.*+?^${}()[\]\\]/g, "\\$&");
      });
      return alts.length > 1 ? `(?:${alts.join("|")})` : alts[0];
    });
    rows.push(new RegExp(`^${parts.join(" ")}$`));
  }
  return rows;
}

/** Logs what it was asked with the two variables that steer real gh, and answers from STUB_*. */
const STUB = `#!/usr/bin/env bash
printf 'host=%s repo=%s argv=%s\\n' "\${GH_HOST-unset}" "\${GH_REPO-unset}" "$*" >>"$STUB_DIR/log"
if [ -n "\${STUB_NOISE:-}" ]; then printf '%s\\n' "$STUB_NOISE"; printf '%s\\n' "$STUB_NOISE" >&2; fi
if [ -n "\${STUB_STDERR:-}" ]; then printf '%s\\n' "$STUB_STDERR" >&2; fi
case "$1 $2" in
  "api user") [ "\${STUB_LOGIN_RC:-0}" = 0 ] || exit 1; printf '%s\\n' "\${STUB_LOGIN:-octo}" ;;
  "api repos/"*)
    [ "\${STUB_REPO_RC:-0}" = 0 ] || exit 1
    if [ -n "\${STUB_RACE_FILE:-}" ]; then : >"$STUB_RACE_FILE"; fi
    printf '%s %s\\n' "\${STUB_ID:?}" "\${STUB_PERMS:-false false}"
    ;;
  "search issues") [ "\${STUB_SEARCH_RC:-0}" = 0 ] || exit 1; printf '%b' "\${STUB_SEARCH:-}" ;;
  "issue create")
    cat >"$STUB_DIR/sent-body"
    printf '%s\\n' "$@" >"$STUB_DIR/sent-argv"
    printf '%s\\n' "\${STUB_CREATE_OUT-}"
    exit "\${STUB_CREATE_RC:-0}"
    ;;
  "issue view") printf '%b' "\${STUB_VIEW_OUT-}"; exit "\${STUB_VIEW_RC:-0}" ;;
esac
`;

export const ISSUE_99 = `https://github.com/${constant("REPO")}/issues/99`;

export const CREATED = { STUB_CREATE_OUT: ISSUE_99, STUB_VIEW_OUT: "99\\n" };

export const createLines = (log: string) =>
  log.split("\n").filter((l) => l.includes("argv=issue create"));

export function assertGrammar(stdout: string) {
  const rows = grammar();
  assertEquals(rows.length, 11, "read the wrong number of grammar rows from the header");
  for (const line of stdout.trimEnd().split("\n")) {
    assert(rows.some((r) => r.test(line)), `outside the grammar: ${JSON.stringify(line)}`);
  }
}

export interface Box {
  sb: Sandbox;
  project: string;
  /** The real script, in the project, with the stub first on PATH; `report` is its stdin. */
  run(args: string[], report?: string, env?: Record<string, string>): Promise<Run>;
  /** Everything the stub was asked, one line per call. */
  log(): Promise<string>;
  /** A file the stub wrote: `sent-body`, `sent-argv`. */
  sent(name: string): Promise<string>;
  /** Where a prepared report lands, in Deno's spelling of the path. */
  reportPath(digest: string): string;
  /** `prepare` a clean bug report and return its digest. */
  prepared(report?: string): Promise<string>;
  /** A command of this name ahead of everything on PATH, with this bash body. */
  shim(name: string, body: string): Promise<void>;
  /** PATH with no `gh` on it, stub included. */
  pathWithoutGh(): Promise<string>;
  cleanup(): Promise<void>;
}

export const REPORT = "A title\n\n## Summary\n\nA body.\n";

async function writeCommand(path: string, content: string): Promise<void> {
  await Deno.writeTextFile(path, content);
  await Deno.chmod(path, 0o755).catch(() => {});
}

/** Runs the script in `cwd` with `base`, a call's own `env` over it, and `report` on stdin. */
function scriptRunner(cwd: string, base: Record<string, string>): Box["run"] {
  return async (args, report = "", env = {}) => {
    const child = new Deno.Command("bash", {
      args: [bashPath(SCRIPT), ...args],
      cwd,
      env: { ...base, ...env },
      clearEnv: true,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(report)).catch(() => {});
    await w.close().catch(() => {});
    const out = await child.output();
    const d = new TextDecoder();
    return { code: out.code, stdout: d.decode(out.stdout), stderr: d.decode(out.stderr) };
  };
}

async function digestOf(run: Box["run"], report: string): Promise<string> {
  const r = await run(["prepare", "--kind", "bug"], report);
  const digest = /^DIGEST ([0-9a-f]{64})$/m.exec(r.stdout)?.[1];
  if (!digest) throw new Error(`prepare did not print a digest: ${r.stdout}`);
  return digest;
}

export async function box(opts: { dir?: string } = {}): Promise<Box> {
  const sb = await sandbox();
  const project = join(sb.dir, opts.dir ?? "project");
  const bin = join(sb.dir, "bin");
  await Deno.mkdir(project, { recursive: true });
  await Deno.mkdir(bin);
  await writeCommand(join(bin, "gh"), STUB);
  const run = scriptRunner(project, {
    ...sb.env,
    USER: "zorgblat",
    PATH: `${bin}${SEP}${sb.env.PATH}`,
    STUB_DIR: bashPath(sb.dir),
    STUB_ID: constant("REPO_ID"),
  });
  return {
    sb,
    project,
    run,
    log: () => Deno.readTextFile(join(sb.dir, "log")).catch(() => ""),
    sent: (name) => Deno.readTextFile(join(sb.dir, name)),
    reportPath: (digest) => join(sb.home, ".specnaut", "reports", `${digest}.md`),
    prepared: (report = REPORT) => digestOf(run, report),
    shim: (name, body) => writeCommand(join(bin, name), `#!/usr/bin/env bash\n${body}\n`),
    pathWithoutGh: () => pathWithoutGh(sb),
    cleanup: () => sb.cleanup(),
  };
}

async function pathWithoutGh(sb: Sandbox): Promise<string> {
  const farm = join(sb.dir, "no-gh");
  await Deno.mkdir(farm, { recursive: true });
  const kept: string[] = [];
  for (const dir of (sb.env.PATH ?? "").split(SEP)) {
    const hasGh = await Deno.stat(join(dir, WINDOWS ? "gh.exe" : "gh")).then(
      () => true,
      () => false,
    );
    if (!hasGh) kept.push(dir);
    else if (!WINDOWS) await linkTools(dir, farm);
  }
  return [farm, ...kept].join(SEP);
}

/** A directory holding gh often holds the coreutils too: keep those, leave gh behind. */
async function linkTools(dir: string, farm: string): Promise<void> {
  const tools = [
    "awk",
    "bash",
    "cat",
    "chmod",
    "dirname",
    "env",
    "find",
    "git",
    "grep",
    "hostname",
    "mkdir",
    "mktemp",
    "mv",
    "od",
    "openssl",
    "perl",
    "rm",
    "sed",
    "sha256sum",
    "shasum",
    "tr",
  ];
  for (const tool of tools) {
    await Deno.symlink(join(dir, tool), join(farm, tool)).catch(() => {});
  }
}
