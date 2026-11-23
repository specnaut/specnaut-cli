import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl, join } from "@std/path";

/**
 * The world `install.sh` runs in for its tests: a `bin/` holding links to exactly the tools the
 * script uses, plus stubs for `curl`, `sudo` and, when a case wants one, `gh`. That folder is the
 * whole PATH. A runner's own `/usr/bin/gh` (Ubuntu images ship one) can then never answer for the
 * stub, so "gh is missing" means missing, and no case can reach a real verifier or the network.
 *
 * curl serves a fake release from files beside the stubs and logs each call; gh logs each call,
 * one argument per line, and answers as the case says; sudo logs and refuses. Every folder is
 * temporary and removed after the case, whatever it did.
 */

export const INSTALL = fromFileUrl(new URL("../../install.sh", import.meta.url));
export const BINARY = '#!/bin/sh\necho "specnaut 9.9.9"\n';
export const PLACEHOLDER = "RELEASE_TAG='__SPECNAUT_RELEASE_TAG__'";
export const ignore = Deno.build.os === "windows"; // install.sh refuses Windows

const TOOLS = [
  ...["uname", "mktemp", "awk", "grep", "sed", "head", "chmod", "mv", "mkdir", "rm", "cat", "cp"],
  ...["dirname", "shasum", "sha256sum"],
];

/** How gh behaves: a verifier that accepts, one that refuses, one without `attestation`, none. */
export type Gh = "valid" | "mismatch" | "no-attestation" | null;

export type World = {
  gh?: Gh;
  /** The text whose SHA-256 the checksum asset carries; the binary's own by default. */
  summed?: string;
  /** What `releases/latest` answers; nothing carrying a tag by default. */
  latest?: string;
  /** A URL suffix curl answers with a 404. */
  missing?: string;
  /** install.sh as it is run; the repository's copy by default. */
  script?: string;
};

export type Sandbox = { bin: string; home: string; tmp: string; script: string };

const curlStub = (dir: string, missing: string) =>
  `#!/bin/sh
printf '%s\\n' "$*" >>'${dir}/curl.log'
out="" url=""
while [ $# -gt 0 ]; do case $1 in -o) out=$2; shift ;; --proto) shift ;; -*) ;; *) url=$1 ;; esac; shift; done
${missing ? `case $url in *'${missing}') exit 22 ;; esac` : ""}
case $url in *.sha256) f=fake.sha256 ;; */releases/latest) f=latest ;; *.sigstore.json) f=bundle ;; *) f=fake ;; esac
if [ -n "$out" ]; then cp '${dir}/'$f "$out"; else cat '${dir}/'$f; fi
`;

function ghStub(dir: string, gh: Exclude<Gh, null>): string {
  const help = gh === "no-attestation"
    ? `echo 'unknown command "attestation"' >&2; exit 1`
    : "exit 0";
  const verify = gh === "valid" ? "exit 0" : `echo 'verification failed' >&2; exit 1`;
  return `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done >>'${dir}/gh.log'
echo -- >>'${dir}/gh.log'
case "$*" in *--help*) ${help} ;; "attestation verify"*) ${verify} ;; esac
exit 1
`;
}

export async function writeExecutable(path: string, text: string): Promise<void> {
  await Deno.writeTextFile(path, text);
  await Deno.chmod(path, 0o755);
}

/**
 * Links each of `tools` into `bin` from /usr/bin or /bin, whichever holds it; a tool neither holds
 * is left out, as on a machine without it.
 */
export async function linkTools(bin: string, tools: readonly string[]): Promise<void> {
  for (const tool of tools) {
    for (const dir of ["/usr/bin", "/bin"]) {
      if (!(await exists(join(dir, tool)))) continue;
      await Deno.symlink(join(dir, tool), join(bin, tool));
      break;
    }
  }
}

/** The fake release curl serves: the binary, a checksum of `world.summed`, a lookup, a bundle. */
async function serveRelease(bin: string, world: World): Promise<void> {
  const summed = new TextEncoder().encode(world.summed ?? BINARY);
  const sha = encodeHex(await crypto.subtle.digest("SHA-256", summed));
  await Deno.writeTextFile(join(bin, "fake"), BINARY);
  await Deno.writeTextFile(join(bin, "fake.sha256"), `${sha}  specnaut\n`);
  await Deno.writeTextFile(join(bin, "latest"), world.latest ?? BINARY);
  await Deno.writeTextFile(join(bin, "bundle"), '{"fake": "bundle"}\n');
}

async function build(world: World): Promise<Sandbox> {
  const [bin, home, tmp] = await Promise.all(
    ["bin", "home", "tmp"].map((p) => Deno.makeTempDir({ prefix: `install-sh-${p}-` })),
  );
  await serveRelease(bin, world);
  await writeExecutable(join(bin, "curl"), curlStub(bin, world.missing ?? ""));
  await writeExecutable(
    join(bin, "sudo"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >>'${bin}/sudo.log'\nexit 1\n`,
  );
  const gh = world.gh === undefined ? "valid" : world.gh;
  if (gh !== null) await writeExecutable(join(bin, "gh"), ghStub(bin, gh));
  await linkTools(bin, TOOLS);
  const script = join(bin, "install.sh");
  await Deno.writeTextFile(script, world.script ?? await Deno.readTextFile(INSTALL));
  return { bin, home, tmp, script };
}

/** /bin/bash run with exactly `env`: its exit code and its stdout and stderr, joined. */
export async function bash(args: string[], env: Record<string, string>, cwd?: string) {
  const r = await new Deno.Command("/bin/bash", {
    args,
    cwd,
    clearEnv: true,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { code: r.code, out: dec.decode(r.stdout) + dec.decode(r.stderr) };
}

/** `fn` given a sandbox built for `world`, every folder of it removed afterwards. */
export async function inSandbox(world: World, fn: (s: Sandbox) => Promise<void>): Promise<void> {
  const s = await build(world);
  try {
    await fn(s);
  } finally {
    for (const dir of [s.bin, s.home, s.tmp]) await Deno.remove(dir, { recursive: true });
  }
}

/**
 * install.sh run with nothing of this process's environment: PREFIX under HOME, the version
 * pinned to v9.9.9 unless `env` says otherwise (an empty value unsets a variable).
 */
export async function install(s: Sandbox, env: Record<string, string> = {}) {
  const all: Record<string, string> = {
    HOME: s.home,
    PATH: s.bin,
    PREFIX: join(s.home, "bin"),
    TMPDIR: s.tmp,
    SPECNAUT_VERSION: "v9.9.9",
    ...env,
  };
  for (const [k, v] of Object.entries(all)) if (v === "") delete all[k];
  return await bash([s.script], all, s.home);
}

/** The text at `path`, or null when nothing is there; any other failure is thrown. */
export function readIfPresent(path: string): Promise<string | null> {
  return Deno.readTextFile(path).catch((e) => {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  });
}

/** A stub's log, empty when it was never called. */
export async function stubLog(s: Sandbox, name: "curl" | "gh" | "sudo"): Promise<string> {
  return await readIfPresent(join(s.bin, `${name}.log`)) ?? "";
}

/** Whether anything was placed at `path`. */
export function exists(path: string): Promise<boolean> {
  return Deno.lstat(path).then(() => true, (e) => {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  });
}

/** install.sh as scripts/release/stage-installer.sh leaves it for `tag`. */
export async function staged(tag: string): Promise<string> {
  return (await Deno.readTextFile(INSTALL)).replace(PLACEHOLDER, `RELEASE_TAG='${tag}'`);
}
