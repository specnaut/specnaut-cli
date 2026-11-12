import { assert } from "@std/assert";
import { writeVersions } from "../../scripts/bump-version.ts";

/** Repositories in the states `check-release-commit.ts` judges, and a way to run it on one. */

const SCRIPT = new URL("../../scripts/check-release-commit.ts", import.meta.url).pathname;

export async function run(cwd: string, tag: string): Promise<{ code: number; err: string }> {
  const out = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-run", SCRIPT, tag],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}

export async function git(cwd: string, ...args: string[]) {
  const out = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" }).output();
  assert(out.success, `git ${args.join(" ")} failed`);
}

/** A temp repository, removed when the test's `await using` ends. */
export type Repo = AsyncDisposable & { readonly dir: string };

/** A repo carrying every version file at `version`, committed with `subject`. */
export async function repoAt(
  version: string,
  subject: string,
  opts: { desync?: string; staleRef?: string } = {},
): Promise<Repo> {
  const dir = await Deno.makeTempDir();
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@t");
  await git(dir, "config", "user.name", "t");
  const json = (v: string) => JSON.stringify({ version: v }, null, 2);
  await Deno.writeTextFile(`${dir}/deno.json`, json(version));
  await Deno.mkdir(`${dir}/src/domain`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/src/domain/version.ts`,
    `export const VERSION = "${opts.desync ?? version}";\n`,
  );
  for (
    const p of [
      "plugin/.claude-plugin/plugin.json",
      "templates/manifest.json",
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      "mods/specnaut-cockpit/.claude-plugin/plugin.json",
    ]
  ) {
    await Deno.mkdir(`${dir}/${p.split("/").slice(0, -1).join("/")}`, { recursive: true });
    await Deno.writeTextFile(`${dir}/${p}`, json(version));
  }
  // Two entries per catalog: the second can be left on an older tag, the
  // case a "does any ref match" check would wave through.
  const catalog = JSON.stringify(
    {
      name: "m",
      plugins: [
        { name: "a", source: { ref: `v${version}` } },
        { name: "b", source: { ref: `v${opts.staleRef ?? version}` } },
      ],
    },
    null,
    2,
  );
  for (
    const p of [
      "packaging/marketplace/.claude-plugin/marketplace.json",
      "packaging/marketplace/.github/plugin/marketplace.json",
    ]
  ) {
    await Deno.mkdir(`${dir}/${p.split("/").slice(0, -1).join("/")}`, { recursive: true });
    await Deno.writeTextFile(`${dir}/${p}`, catalog);
  }
  await Deno.mkdir(`${dir}/templates/harness-specific/claude`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/templates/harness-specific/claude/settings.json`,
    JSON.stringify({
      extraKnownMarketplaces: { "specnaut-marketplace": { source: { ref: `v${version}` } } },
    }),
  );
  await Deno.writeTextFile(
    `${dir}/README.md`,
    `\`"plugin": ["specnaut@git+https://github.com/specnaut/specnaut-cli.git#v${version}"]\`\n`,
  );
  // No highlights here, so the release records an empty history file (cli#759).
  await recordHistory(dir, `v${version}`, "");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", subject);
  return { dir, [Symbol.asyncDispose]: () => Deno.remove(dir, { recursive: true }) };
}

export const H = ".specnaut/release/HIGHLIGHTS.md";
export const LEAD =
  "**A thing shipped.**\n\nIt does the thing, and here is why that matters to you.\n";

/**
 * What the release step writes beside the bump (cli#759): `HIGHLIGHTS.md` as
 * `history/<tag>.md`. `null` writes nothing, for the case the gate refuses.
 */
export async function recordHistory(dir: string, tag: string, text: string | null) {
  await Deno.mkdir(`${dir}/.specnaut/release/history`, { recursive: true });
  if (text !== null) await Deno.writeTextFile(`${dir}/.specnaut/release/history/${tag}.md`, text);
}

/**
 * A repo tagged at `prev` carrying `lead`, then bumped to `next`, whose release
 * commit records `record` as its history file — by default, `HIGHLIGHTS.md` as
 * it stands then.
 */
export async function repoWithHighlights(
  prev: string,
  next: string,
  lead: string,
  after: (dir: string) => Promise<void>,
  record?: string | null,
): Promise<Repo> {
  const repo = await repoAt(prev.slice(1), `chore: release ${prev}`);
  const { dir } = repo;
  await Deno.mkdir(`${dir}/.specnaut/release`, { recursive: true });
  await Deno.writeTextFile(`${dir}/${H}`, lead);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "docs(release): the lead");
  await git(dir, "tag", "-a", prev, "-m", prev);
  await after(dir);
  // The bump to `next`, in its own commit, written by the pipeline's own
  // writer: a second list of version files here would drift from the real one.
  await writeVersions(next.slice(1), dir);
  await recordHistory(
    dir,
    next,
    record !== undefined ? record : await Deno.readTextFile(`${dir}/${H}`),
  );
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", `chore: release ${next}`);
  return repo;
}
