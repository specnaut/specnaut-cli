import { assert, assertEquals, assertRejects } from "@std/assert";
import { SelfUpdateUseCase } from "../../src/application/self_update.ts";
import { Release, SemVer } from "../../src/domain/release.ts";
import type { Downloader, ReleaseChecker } from "../../src/application/ports.ts";

function fakeChecker(release: Release): ReleaseChecker {
  return { getLatest: () => Promise.resolve(release) };
}

function fakeDownloader(payload: Uint8Array, sha256: string): Downloader {
  return {
    download: () => Promise.resolve(payload),
    downloadText: (_url: string) => Promise.resolve(`${sha256}  file\n`),
  };
}

// SHA-256 of a single 0x00 byte:
const ZERO_BYTE = new Uint8Array([0]);
const ZERO_SHA = "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d";

Deno.test("SelfUpdateUseCase reports 'up-to-date' when current >= latest", async () => {
  const release = new Release(SemVer.parse("0.1.0"), [
    { name: "specflow-macos-arm64", url: "https://x/bin" },
    { name: "specflow-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, ZERO_SHA),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specflow",
    replaceBinary: () => Promise.resolve(),
  });
  const result = await uc.execute({ checkOnly: false });
  assertEquals(result.status, "up-to-date");
});

Deno.test("SelfUpdateUseCase downloads, verifies, and replaces when newer", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specflow-macos-arm64", url: "https://x/bin" },
    { name: "specflow-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  let replaced = false;
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, ZERO_SHA),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specflow",
    replaceBinary: (bytes) => {
      assertEquals(bytes, ZERO_BYTE);
      replaced = true;
      return Promise.resolve();
    },
  });
  const result = await uc.execute({ checkOnly: false });
  assertEquals(result.status, "updated");
  assert(replaced);
});

Deno.test("SelfUpdateUseCase 'available' in check-only mode without downloading", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specflow-macos-arm64", url: "https://x/bin" },
    { name: "specflow-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  let downloadCalled = false;
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: {
      download: () => {
        downloadCalled = true;
        return Promise.resolve(new Uint8Array());
      },
      downloadText: () => Promise.resolve(""),
    },
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specflow",
    replaceBinary: () => Promise.resolve(),
  });
  const result = await uc.execute({ checkOnly: true });
  assertEquals(result.status, "available");
  assertEquals(downloadCalled, false);
});

Deno.test("SelfUpdateUseCase rejects when SHA256 mismatches", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specflow-macos-arm64", url: "https://x/bin" },
    { name: "specflow-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, "deadbeef".padEnd(64, "0")),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specflow",
    replaceBinary: () => Promise.resolve(),
  });
  await assertRejects(() => uc.execute({ checkOnly: false }), Error, "checksum");
});

Deno.test("SelfUpdateUseCase rejects when no asset matches the platform", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specflow-other-platform", url: "https://x" },
  ]);
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, ZERO_SHA),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specflow",
    replaceBinary: () => Promise.resolve(),
  });
  await assertRejects(() => uc.execute({ checkOnly: false }), Error, "platform");
});
