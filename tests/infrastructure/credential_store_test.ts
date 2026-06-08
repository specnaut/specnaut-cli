import { assertEquals } from "@std/assert";
import {
  type CloudCredentials,
  FileCredentialStore,
} from "../../src/infrastructure/credential_store.ts";

async function withTempFile(fn: (path: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-cred-" });
  try {
    await fn(`${dir}/credentials.json`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const creds = (over: Partial<CloudCredentials> = {}): CloudCredentials => ({
  accessToken: "sfc_access",
  refreshToken: "sfr_refresh",
  accessExpiresAt: 1_000_000,
  ...over,
});

Deno.test("FileCredentialStore: kind is 'file'", () => {
  assertEquals(new FileCredentialStore().kind, "file");
});

Deno.test("FileCredentialStore: save → load round-trips", async () => {
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    const url = "https://dep.convex.site";
    assertEquals(await store.load(url), null);
    await store.save(url, creds());
    assertEquals(await store.load(url), creds());
  });
});

Deno.test("FileCredentialStore: keys by deployment, trailing slash normalized", async () => {
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    await store.save("https://a.convex.site/", creds({ accessToken: "A" }));
    await store.save("https://b.convex.site", creds({ accessToken: "B" }));
    // trailing slash on save + bare on load resolve to the same key
    assertEquals((await store.load("https://a.convex.site"))?.accessToken, "A");
    assertEquals((await store.load("https://b.convex.site/"))?.accessToken, "B");
  });
});

Deno.test("FileCredentialStore: delete removes only the target deployment", async () => {
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    await store.save("https://a.convex.site", creds({ accessToken: "A" }));
    await store.save("https://b.convex.site", creds({ accessToken: "B" }));
    await store.delete("https://a.convex.site");
    assertEquals(await store.load("https://a.convex.site"), null);
    assertEquals((await store.load("https://b.convex.site"))?.accessToken, "B");
  });
});

Deno.test("FileCredentialStore: file is created with 0600 perms", async () => {
  if (Deno.build.os === "windows") return; // POSIX perms only
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    await store.save("https://a.convex.site", creds());
    const mode = (await Deno.stat(path)).mode ?? 0;
    assertEquals(mode & 0o777, 0o600);
  });
});

Deno.test("FileCredentialStore: corrupt file is treated as empty (auth never wedges)", async () => {
  await withTempFile(async (path) => {
    await Deno.writeTextFile(path, "}{ not json");
    const store = new FileCredentialStore(path);
    assertEquals(await store.load("https://a.convex.site"), null);
    // and a subsequent save still works (overwrites the garbage)
    await store.save("https://a.convex.site", creds());
    assertEquals((await store.load("https://a.convex.site"))?.accessToken, "sfc_access");
  });
});
