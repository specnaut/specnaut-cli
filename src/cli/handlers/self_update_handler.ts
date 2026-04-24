import { bold, dim, green, yellow } from "@std/fmt/colors";
import { SelfUpdateUseCase } from "../../application/self_update.ts";
import {
  FetchDownloader,
  GitHubReleaseChecker,
  replaceRunningBinary,
} from "../../infrastructure/github_api.ts";
import { VERSION } from "../../domain/version.ts";

export type SelfUpdateIntent = {
  kind: "self-update";
  checkOnly: boolean;
};

function detectPlatform(): string {
  const os = Deno.build.os;
  const arch = Deno.build.arch;
  if (os === "darwin" && arch === "aarch64") return "macos-arm64";
  if (os === "darwin" && arch === "x86_64") return "macos-x64";
  if (os === "linux" && arch === "aarch64") return "linux-arm64";
  if (os === "linux" && arch === "x86_64") return "linux-x64";
  if (os === "windows" && arch === "x86_64") return "windows-x64";
  throw new Error(`Unsupported platform: ${os}-${arch}`);
}

export async function handleSelfUpdate(intent: SelfUpdateIntent): Promise<number> {
  const useCase = new SelfUpdateUseCase({
    checker: new GitHubReleaseChecker(),
    downloader: new FetchDownloader(),
    currentVersion: VERSION,
    currentPlatform: detectPlatform(),
    currentBinaryPath: Deno.execPath(),
    replaceBinary: (bytes) => replaceRunningBinary(Deno.execPath(), bytes),
  });

  console.log(`${bold("specflow")} self-update ${dim(`(current ${VERSION})`)}`);
  try {
    const result = await useCase.execute({ checkOnly: intent.checkOnly });
    switch (result.status) {
      case "up-to-date":
        console.log(green(`✓ already up to date (${result.currentVersion})`));
        return 0;
      case "available":
        console.log(
          yellow(
            `↑ update available: ${result.latestVersion} (current ${result.currentVersion})`,
          ),
        );
        console.log("Run `specflow self-update` to install.");
        return 0;
      case "updated":
        console.log(green(`✓ updated ${result.previousVersion} → ${result.newVersion}`));
        console.log();
        console.log(
          dim(
            "Don't forget to run `specflow upgrade` in each project that was\n" +
              "previously scaffolded with `specflow init` to pull in new templates.",
          ),
        );
        return 0;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`error: ${msg}`);
    return 1;
  }
}
