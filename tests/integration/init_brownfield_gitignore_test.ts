import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

const VITE_GITIGNORE = `# Logs
logs
*.log
npm-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
`;

async function runSpecflow(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-brownfield-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("init --here on a Vite-style project preserves the user .gitignore via merge block", async () => {
  await withTempDir(async (parent) => {
    const root = join(parent, "vite-demo");
    await Deno.mkdir(root, { recursive: true });
    await Deno.writeTextFile(join(root, ".gitignore"), VITE_GITIGNORE);
    // Plausible Vite scaffold so the test reflects the brownfield case.
    await Deno.writeTextFile(join(root, "package.json"), `{"name":"vite-demo"}`);

    const { code, stderr } = await runSpecflow(
      ["init", "--here", "--no-git"],
      { cwd: root },
    );
    assertEquals(code, 0, `expected init to succeed without --force; got ${code}: ${stderr}`);

    const merged = await Deno.readTextFile(join(root, ".gitignore"));
    // User's lines preserved verbatim.
    assertStringIncludes(merged, "node_modules");
    assertStringIncludes(merged, "dist-ssr");
    assertStringIncludes(merged, ".DS_Store");
    // Specflow block is fenced and at the end.
    assertStringIncludes(merged, "# --- Specflow: gitignore ---");
    assertStringIncludes(merged, "*.specflow.bak");
    assertStringIncludes(merged, ".specflow/config.yml.local");
    assertStringIncludes(merged, "# --- End Specflow: gitignore ---");
    // No backup created — merge is non-destructive.
    assertEquals(await exists(join(root, ".gitignore.specflow.bak")), false);
  });
});

Deno.test("init --here twice does not duplicate the merge block (idempotency)", async () => {
  await withTempDir(async (parent) => {
    const root = join(parent, "demo");
    await Deno.mkdir(root, { recursive: true });
    await Deno.writeTextFile(join(root, ".gitignore"), VITE_GITIGNORE);

    const first = await runSpecflow(["init", "--here", "--no-git"], { cwd: root });
    assertEquals(first.code, 0, `first init failed: ${first.stderr}`);

    const second = await runSpecflow(["init", "--here", "--no-git", "--force"], { cwd: root });
    assertEquals(second.code, 0, `second init failed: ${second.stderr}`);

    const merged = await Deno.readTextFile(join(root, ".gitignore"));
    const fenceCount = (merged.match(/# --- Specflow: gitignore ---/g) ?? []).length;
    assertEquals(fenceCount, 1, "specflow block must appear exactly once");
    // User content still present.
    assertStringIncludes(merged, "node_modules");
  });
});

Deno.test("init --here greenfield writes the .gitignore wrapped in fence markers", async () => {
  await withTempDir(async (parent) => {
    const root = join(parent, "demo");
    // No pre-existing .gitignore; test the greenfield merge shape.
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const content = await Deno.readTextFile(join(root, ".gitignore"));
    assertStringIncludes(content, "# --- Specflow: gitignore ---");
    assertStringIncludes(content, "*.specflow.bak");
    assertStringIncludes(content, ".specflow/config.yml.local");
    assertStringIncludes(content, "# --- End Specflow: gitignore ---");
  });
});
