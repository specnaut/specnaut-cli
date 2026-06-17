import { assertEquals } from "@std/assert";
import {
  readCloudConfig,
  renderCloudConfig,
  writeCloudConfig,
} from "../../src/domain/cloud/cloud_config.ts";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-cloudcfg-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("renderCloudConfig: backend + coordinates, never a secret", () => {
  const yaml = renderCloudConfig("https://dep.convex.site", "CLOUD");
  assertEquals(yaml.includes("backend: cloud"), true);
  assertEquals(yaml.includes("https://dep.convex.site"), true);
  assertEquals(yaml.includes("CLOUD"), true);
  assertEquals(yaml.includes("api_token"), false);
});

Deno.test("write → read round-trips api_url + project_key", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await readCloudConfig(dir), null);
    await writeCloudConfig(dir, "https://dep.convex.site", "CLOUD");
    assertEquals(await readCloudConfig(dir), {
      apiUrl: "https://dep.convex.site",
      projectKey: "CLOUD",
    });
  });
});

Deno.test("empty stub parses to empty coordinates (pre-login state)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(`${dir}/.specnaut`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.specnaut/backlog-config.yml`, renderCloudConfig());
    // The rendered stub's `remote:` block is commented out, so it round-trips to
    // exactly the prior shape — no `remote` key (backward compatible, #357).
    assertEquals(await readCloudConfig(dir), { apiUrl: "", projectKey: "" });
  });
});

Deno.test("an explicit remote: block parses into the config (#357)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(`${dir}/.specnaut`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.specnaut/backlog-config.yml`,
      [
        "backend: cloud",
        'api_url: "https://dep.convex.site"',
        'project_key: "CLOUD"',
        "remote:",
        "  enabled: true",
        "  await_timeout_s: 600",
        "  poll_interval_s: 10",
        "",
      ].join("\n"),
    );
    assertEquals(await readCloudConfig(dir), {
      apiUrl: "https://dep.convex.site",
      projectKey: "CLOUD",
      remote: { enabled: true, awaitTimeoutS: 600, pollIntervalS: 10 },
    });
  });
});
