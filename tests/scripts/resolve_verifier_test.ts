import { assertEquals } from "@std/assert";
import { DELIMITER, fromFileUrl, join } from "@std/path";
import { git, run } from "./git_sandbox.ts";

/**
 * The rule that resolves `specnaut` before it runs has two spellings that cannot share code:
 * `phases/script-gate.md` § Resolving the verifier, which runs before any script of the tree is
 * trusted, and `resolve_specnaut` in `_verifier.sh`, which `land-feature.sh` sources. One table of
 * PATHs runs both, and each case must get the same answer from each: the physical file, or a
 * refusal naming why.
 */

const ROOT = new URL("../../templates/core/", import.meta.url);
const LIB = fromFileUrl(new URL("specnaut/scripts/bash/_verifier.sh", ROOT));

/** The bash block after the resolve anchor in the gate doc, as written. */
function docBlock(): string {
  const doc = Deno.readTextFileSync(new URL("skills/task/phases/script-gate.md", ROOT));
  const after = doc.split("<!-- script-gate: resolve-verifier -->")[1];
  const m = /^\s*```bash\n([\s\S]*?)\n```/.exec(after ?? "");
  if (!m) throw new Error("script-gate.md lost its resolve block");
  return m[1];
}

/** `resolve_specnaut` as land-feature.sh runs it: its shell options, alias and ERR trap first. */
const LAND = `set -Eeuo pipefail
shopt -s expand_aliases
alias git='git -c core.hooksPath=/dev/null'
trap 'echo "ERR trap: $BASH_COMMAND" >&2; exit 12' ERR
. '${LIB}'
resolve_specnaut`;

type Answer = { resolved: string } | { refused: string };

/** Each spelling's answer, `PATH` set to `path` in `cwd`; bash itself is named by its full path. */
async function answers(bash: string, path: string, cwd: string): Promise<Answer[]> {
  const env = { PATH: path };
  const doc = await run(bash, ["-c", `${docBlock()}\nprintf 'SN %s\\n' "$sn"`], cwd, env);
  const land = await run(bash, ["-c", `${LAND}\nprintf 'SN %s\\n' "$sn"`], cwd, env);
  const sn = (out: string) => /^SN (.+)$/m.exec(out)?.[1];
  const why = (out: string) =>
    /VERIFIER REFUSED: \S+ (.+?)( - could not judge.*)?$/m.exec(out)?.[1];
  const docAnswer: Answer = sn(doc.stdout)
    ? { resolved: sn(doc.stdout)! }
    : { refused: why(doc.stdout) ?? `no refusal line: ${doc.stdout}${doc.stderr}` };
  const landAnswer: Answer = land.code === 0 && sn(land.stdout)
    ? { resolved: sn(land.stdout)! }
    : land.code === 13
    ? { refused: why(land.stderr) ?? `no refusal line: ${land.stderr}` }
    : { refused: `exit ${land.code}: ${land.stderr}` };
  return [docAnswer, landAnswer];
}

async function stub(dir: string): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const file = join(dir, "specnaut");
  await Deno.writeTextFile(file, "#!/bin/sh\necho stub\n");
  await Deno.chmod(file, 0o755);
  return file;
}

/** One PATH, where it runs from, and the answer both spellings must give. */
type Case = { name: string; path: string; cwd: string; expect: Answer; skip?: string };

/** The folders and files the cases name, all under one physical temp folder. */
type Layout = {
  tmp: string;
  repo: string;
  tools: string;
  inRepo: string;
  outside: string;
  sibling: string;
  caseBlind: boolean;
};

/** A folder holding only the tools both spellings run, each a link to the real one. */
async function toolsIn(tmp: string): Promise<string> {
  const tools = join(tmp, "tools");
  await Deno.mkdir(tools);
  for (const tool of ["git", "readlink"]) {
    const real = (await run("bash", ["-c", `command -v ${tool}`], tmp)).stdout.trim();
    await Deno.symlink(real, join(tools, tool));
  }
  return tools;
}

/** A repository, stubs inside, outside and beside it, and the tools. */
async function layout(tmp: string): Promise<Layout> {
  const repo = join(tmp, "repo");
  await Deno.mkdir(repo);
  await git(repo, "init", "--quiet");
  const l: Layout = {
    tmp,
    repo,
    tools: await toolsIn(tmp),
    inRepo: await stub(join(repo, "bin")),
    outside: await stub(join(tmp, "outside", "real")),
    sibling: await stub(join(tmp, "repo-x", "bin")),
    caseBlind: await Deno.stat(join(tmp, "REPO", "bin")).then(() => true, () => false),
  };
  await links(l);
  return l;
}

/** A linked parent, links across the repository's edge both ways, and a chain of relative links. */
async function links(l: Layout) {
  await Deno.symlink(l.repo, join(l.tmp, "alias"));
  await Deno.mkdir(join(l.tmp, "outside", "links"));
  await Deno.symlink(l.inRepo, join(l.tmp, "outside", "links", "specnaut"));
  await Deno.mkdir(join(l.repo, "linkbin"));
  await Deno.symlink(l.outside, join(l.repo, "linkbin", "specnaut"));
  const chain = join(l.tmp, "outside", "chain");
  await Deno.mkdir(chain);
  await Deno.symlink(l.outside, join(chain, "c2"));
  await Deno.symlink("c2", join(chain, "c1"));
  await Deno.symlink("../chain/c1", join(chain, "specnaut"));
}

const inside = { refused: "is inside the repository" };
const relative = { refused: "is not an absolute path" };

/** Every case, its PATH ending with the tools folder. */
function casesFor(l: Layout): Case[] {
  const at = (...entries: string[]) => [...entries, l.tools].join(DELIMITER);
  const bin = join(l.repo, "bin");
  // deno-fmt-ignore
  return [
    { name: "a relative entry", path: at("bin"), cwd: l.repo, expect: relative },
    { name: "an empty entry", path: `${DELIMITER}${l.tools}`, cwd: bin, expect: relative },
    { name: "a `.` entry", path: at("."), cwd: bin, expect: relative },
    { name: "no specnaut at all", path: l.tools, cwd: l.repo, expect: { refused: "is not on the PATH" } },
    { name: "an in-repo folder", path: at(bin), cwd: l.repo, expect: inside },
    { name: "an in-repo folder through a linked parent", path: at(join(l.tmp, "alias", "bin")), cwd: l.repo, expect: inside },
    { name: "a link outside naming an in-repo file", path: at(join(l.tmp, "outside", "links")), cwd: l.repo, expect: inside },
    { name: "a link inside naming an outside file", path: at(join(l.repo, "linkbin")), cwd: l.repo, expect: inside },
    { name: "the repository named in another case", path: at(join(l.tmp, "REPO", "bin")), cwd: l.repo, expect: inside, skip: l.caseBlind ? undefined : "this file system tells case apart" },
    { name: "a sibling `<repo>-x`", path: at(join(l.tmp, "repo-x", "bin")), cwd: l.repo, expect: { resolved: l.sibling } },
    { name: "a chain of relative links outside", path: at(join(l.tmp, "outside", "chain")), cwd: l.repo, expect: { resolved: l.outside } },
    { name: "outside the repository", path: at(join(l.tmp, "outside", "real")), cwd: l.repo, expect: { resolved: l.outside } },
  ];
}

Deno.test({
  name: "both spellings of the verifier's resolution answer every case alike",
  // Symlinks need a privilege Windows runners lack, and the stub needs POSIX exec bits.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const tmp = await Deno.realPath(await Deno.makeTempDir({ prefix: "resolve-verifier-" }));
    try {
      const bash = (await run("bash", ["-c", "command -v bash"], tmp)).stdout.trim();
      for (const c of casesFor(await layout(tmp))) {
        if (c.skip) {
          console.warn(`skipped "${c.name}": ${c.skip}`);
          continue;
        }
        const [doc, land] = await answers(bash, c.path, c.cwd);
        assertEquals(doc, c.expect, `the gate doc, ${c.name}`);
        assertEquals(land, c.expect, `_verifier.sh, ${c.name}`);
      }
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
});
