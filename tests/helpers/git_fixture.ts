/**
 * Crafted git objects for tests: trees written byte for byte with `hash-object --literally`, so a
 * fixture can hold a name `git mktree` would refuse (a slash, `.git`, bytes that are not UTF-8).
 */

/** Runs git in `cwd` with a fixed identity and locale; throws with stderr on failure. */
export async function git(cwd: string, args: string[], input?: Uint8Array): Promise<string> {
  const child = new Deno.Command("git", {
    args: ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    cwd,
    env: { LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1" },
    stdin: input === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (input !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(input);
    await writer.close();
  }
  const out = await child.output();
  const text = new TextDecoder().decode(out.stdout).trim();
  if (out.code !== 0) {
    throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`);
  }
  return text;
}

export async function initRepo(dir: string): Promise<string> {
  await git(dir, ["init", "-q", "--initial-branch=main"]);
  return dir;
}

export async function blob(repo: string, content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return await git(repo, ["hash-object", "-w", "--stdin"], bytes);
}

/** One raw entry: its mode as git writes it (`40000` for a tree), its name bytes, its id. */
export type RawEntry = readonly [mode: string, name: string | Uint8Array, id: string];

export async function tree(repo: string, entries: readonly RawEntry[]): Promise<string> {
  const parts: number[] = [];
  const enc = new TextEncoder();
  for (const [mode, name, id] of entries) {
    parts.push(...enc.encode(`${mode} `), ...(typeof name === "string" ? enc.encode(name) : name));
    parts.push(0, ...id.match(/../g)!.map((h) => parseInt(h, 16)));
  }
  const args = ["hash-object", "-w", "-t", "tree", "--literally", "--stdin"];
  return await git(repo, args, new Uint8Array(parts));
}

export async function commit(repo: string, treeId: string, ref?: string): Promise<string> {
  const id = await git(repo, ["commit-tree", "-m", "fixture", treeId]);
  if (ref !== undefined) await git(repo, ["update-ref", ref, id]);
  return id;
}

/** A fresh temp folder with its real path, so a comparison is not fooled by `/var` -> `/private`. */
export async function tempDir(prefix: string): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }));
}
