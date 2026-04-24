import type { Downloader, ReleaseChecker } from "./ports.ts";
import { SemVer } from "../domain/release.ts";

export type SelfUpdateResult =
  | { status: "up-to-date"; currentVersion: string }
  | { status: "available"; currentVersion: string; latestVersion: string }
  | { status: "updated"; previousVersion: string; newVersion: string };

export type SelfUpdateDeps = {
  checker: ReleaseChecker;
  downloader: Downloader;
  currentVersion: string;
  currentPlatform: string;
  currentBinaryPath: string;
  replaceBinary: (bytes: Uint8Array) => Promise<void>;
};

export class SelfUpdateUseCase {
  constructor(private readonly deps: SelfUpdateDeps) {}

  async execute(opts: { checkOnly: boolean }): Promise<SelfUpdateResult> {
    const { checker, downloader, currentVersion, currentPlatform, replaceBinary } = this.deps;

    const current = SemVer.parse(currentVersion);
    const release = await checker.getLatest();

    if (!release.version.isNewerThan(current)) {
      return { status: "up-to-date", currentVersion };
    }

    if (opts.checkOnly) {
      return {
        status: "available",
        currentVersion,
        latestVersion: release.version.toString(),
      };
    }

    const asset = release.assetFor(currentPlatform);
    if (!asset) {
      throw new Error(`No release asset for platform ${currentPlatform}`);
    }
    const checksumAsset = release.checksumAssetFor(currentPlatform);
    if (!checksumAsset) {
      throw new Error(`No checksum asset for platform ${currentPlatform}`);
    }

    const [bytes, checksumText] = await Promise.all([
      downloader.download(asset.url),
      downloader.downloadText(checksumAsset.url),
    ]);

    const expectedSha = checksumText.trim().split(/\s+/)[0];
    const actualSha = await sha256Hex(bytes);
    if (expectedSha !== actualSha) {
      throw new Error(
        `Downloaded binary checksum mismatch: expected ${expectedSha}, got ${actualSha}`,
      );
    }

    await replaceBinary(bytes);

    return {
      status: "updated",
      previousVersion: currentVersion,
      newVersion: release.version.toString(),
    };
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
