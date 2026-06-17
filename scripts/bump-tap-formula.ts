// Regenerate `Formula/specnaut.rb` in `specnaut/homebrew-tap` with the
// version + SHA-256 checksums from the just-built `dist/`. Commit + push.
//
// Designed to run as a step in `.github/workflows/release.yml`, after
// "Compute checksums" and "Create release" — the four `dist/*.sha256`
// sidecars must already exist.
//
// Required env:
//   GITHUB_REF_NAME      e.g. "v0.9.3" (the tag that triggered the release)
//   HOMEBREW_TAP_TOKEN   fine-grained PAT with Contents: write on
//                        specnaut/homebrew-tap. If unset, the script logs
//                        a workflow warning and exits 0 — a one-off
//                        release with the secret missing should not fail
//                        the pipeline.
//
// Optional env (for local dry-run):
//   DRY_RUN=1            print the rendered formula to stdout and stop.

import { join } from "@std/path";

const REPO = "specnaut/homebrew-tap";
const FORMULA_PATH = "Formula/specnaut.rb";

type RenderInput = {
  tag: string;
  version: string;
  shaMacOsArm: string;
  shaMacOsX64: string;
  shaLinuxArm: string;
  shaLinuxX64: string;
};

export function renderFormula(opts: RenderInput): string {
  const baseUrl = `https://github.com/specnaut/specnaut-cli/releases/download/${opts.tag}`;
  return `class Specnaut < Formula
  desc "AI project scaffolding CLI with auto-chained workflow, review, and backlog"
  homepage "https://specnaut.com"
  version "${opts.version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${baseUrl}/specnaut-macos-arm64"
      sha256 "${opts.shaMacOsArm}"
    end
    on_intel do
      url "${baseUrl}/specnaut-macos-x64"
      sha256 "${opts.shaMacOsX64}"
    end
  end

  on_linux do
    on_arm do
      url "${baseUrl}/specnaut-linux-arm64"
      sha256 "${opts.shaLinuxArm}"
    end
    on_intel do
      url "${baseUrl}/specnaut-linux-x64"
      sha256 "${opts.shaLinuxX64}"
    end
  end

  def install
    bin.install Dir["specnaut-*"].first => "specnaut"
  end

  test do
    assert_match(/^specnaut #{version}/, shell_output("#{bin}/specnaut --version"))
  end
end
`;
}

async function readSha(distDir: string, asset: string): Promise<string> {
  const raw = await Deno.readTextFile(join(distDir, `specnaut-${asset}.sha256`));
  // shasum format: "<sha>  <filename>" — first whitespace-separated token.
  return raw.trim().split(/\s+/)[0];
}

async function run(cmd: string[], cwd?: string): Promise<void> {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await p.output();
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed with exit ${code}`);
}

async function captureStdout(cmd: string[], cwd?: string): Promise<string> {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "inherit",
  });
  const { code, stdout } = await p.output();
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed with exit ${code}`);
  return new TextDecoder().decode(stdout);
}

async function main(): Promise<number> {
  const tag = Deno.env.get("GITHUB_REF_NAME");
  if (!tag) throw new Error("GITHUB_REF_NAME is required");
  if (!tag.startsWith("v")) {
    throw new Error(`GITHUB_REF_NAME must start with 'v', got '${tag}'`);
  }
  const version = tag.slice(1);

  const formula = renderFormula({
    tag,
    version,
    shaMacOsArm: await readSha("dist", "macos-arm64"),
    shaMacOsX64: await readSha("dist", "macos-x64"),
    shaLinuxArm: await readSha("dist", "linux-arm64"),
    shaLinuxX64: await readSha("dist", "linux-x64"),
  });

  if (Deno.env.get("DRY_RUN") === "1") {
    console.log(formula);
    return 0;
  }

  const token = Deno.env.get("HOMEBREW_TAP_TOKEN");
  if (!token) {
    console.log(
      `::warning::HOMEBREW_TAP_TOKEN not set — skipping ${REPO} bump for ${tag}.`,
    );
    return 0;
  }

  const workdir = await Deno.makeTempDir({ prefix: "homebrew-tap-bump-" });
  try {
    const cloneUrl = `https://x-access-token:${token}@github.com/${REPO}.git`;
    await run(["git", "clone", "--depth", "1", cloneUrl, workdir]);
    await Deno.writeTextFile(join(workdir, FORMULA_PATH), formula);

    // Idempotency: re-running the same release shouldn't produce empty commits.
    const dirty = (await captureStdout(["git", "status", "--porcelain"], workdir)).trim();
    if (!dirty) {
      console.log(`Formula already at ${version} — nothing to bump.`);
      return 0;
    }

    await run(["git", "config", "user.name", "github-actions[bot]"], workdir);
    await run(
      [
        "git",
        "config",
        "user.email",
        "41898282+github-actions[bot]@users.noreply.github.com",
      ],
      workdir,
    );
    await run(["git", "add", FORMULA_PATH], workdir);
    await run(["git", "commit", "-m", `chore: bump specnaut to ${version}`], workdir);
    await run(["git", "push", "origin", "HEAD:main"], workdir);
    console.log(`✓ pushed bump to ${version} on ${REPO}`);
    return 0;
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
