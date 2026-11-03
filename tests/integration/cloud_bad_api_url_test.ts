import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";

// cli#736 — a project whose api_url is set and refused is not "not Cloud-linked".
// Through the real binary: the handlers' own session wiring is what is under test.

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function inProject(apiUrl: string, args: string[]) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-bad-url-" });
  try {
    await Deno.mkdir(join(dir, ".specnaut"));
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      `backend: cloud\napi_url: ${JSON.stringify(apiUrl)}\nproject_key: CLOUD\n`,
    );
    await new FsLockStore().write(dir, {
      version: 2,
      harness: "claude",
      backlogBackend: "cloud",
      versionScheme: "semver",
      specBackend: "cloud",
      templatesVersion: "0.0.0",
      entries: new Map(),
    });
    const { code, stderr } = await new Deno.Command("deno", {
      args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
      cwd: dir,
      env: { HOME: dir, USERPROFILE: dir, PATH: Deno.env.get("PATH") ?? "" },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return { code, err: new TextDecoder().decode(stderr) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

for (
  const args of [
    ["gate", "status"],
    ["gate", "cancel", "g"],
    ["spec", "pull", "1"],
  ]
) {
  Deno.test(`\`${args.join(" ")}\`: a refused api_url is reported as such`, async () => {
    for (const url of ["file:///tmp/x", "https://user:pw@collector.invalid"]) {
      const { code, err } = await inProject(url, args);
      assertEquals(code, 1, err);
      assertStringIncludes(err, "invalid Specnaut Cloud API URL");
      assertEquals(err.includes("not Cloud-linked"), false, err);
    }
  });
}

Deno.test("`gate status`: no api_url at all still reads as not Cloud-linked", async () => {
  const { code, err } = await inProject("", ["gate", "status"]);
  assertEquals(code, 5, err);
  assertStringIncludes(err, "not Cloud-linked");
});
