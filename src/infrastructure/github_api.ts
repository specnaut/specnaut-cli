import type { Downloader, ReleaseChecker } from "../application/ports.ts";
import { type Asset, Release, SemVer } from "../domain/release.ts";

const DEFAULT_REPO = "kevinraimbaud/specflow";

type RawAsset = { name: string; browser_download_url: string };
type RawRelease = { tag_name: string; assets: RawAsset[] };

export class GitHubReleaseChecker implements ReleaseChecker {
  constructor(private readonly repo: string = DEFAULT_REPO) {}

  async getLatest(): Promise<Release> {
    const url = `https://api.github.com/repos/${this.repo}/releases/latest`;
    const res = await fetch(url, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status} for ${url}`);
    }
    const raw = (await res.json()) as RawRelease;
    const assets: Asset[] = raw.assets.map((a) => ({
      name: a.name,
      url: a.browser_download_url,
    }));
    return new Release(SemVer.parse(raw.tag_name), assets);
  }
}

export class FetchDownloader implements Downloader {
  async download(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async downloadText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} for ${url}`);
    return await res.text();
  }
}

export async function replaceRunningBinary(
  currentPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const tmp = `${currentPath}.new`;
  await Deno.writeFile(tmp, bytes, { mode: 0o755 });
  if (Deno.build.os === "windows") {
    throw new Error(
      `Downloaded new binary to ${tmp}. On Windows, exit specflow and run:\n` +
        `  move /Y "${tmp}" "${currentPath}"`,
    );
  }
  await Deno.rename(tmp, currentPath);
}
