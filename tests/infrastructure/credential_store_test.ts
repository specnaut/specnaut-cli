import { assertEquals } from "@std/assert";
import type { CloudCredentials } from "../../src/domain/cloud/credentials.ts";
import { FileCredentialStore } from "../../src/infrastructure/credential_store.ts";

async function withTempFile(fn: (path: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-cred-" });
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

Deno.test("FileCredentialStore: reads legacy ~/.specflow when ~/.specnaut is absent", async () => {
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  const prevHome = Deno.env.get("HOME");
  const prevUserProfile = Deno.env.get("USERPROFILE");
  try {
    Deno.env.set("HOME", home);
    Deno.env.set("USERPROFILE", home);
    // Pre-rebrand login: only the legacy dir exists.
    await Deno.mkdir(`${home}/.specflow`, { recursive: true });
    await Deno.writeTextFile(
      `${home}/.specflow/credentials.json`,
      JSON.stringify({ "https://api.example.com": creds() }),
    );

    const store = new FileCredentialStore(); // default home path + legacy fallback
    const loaded = await store.load("https://api.example.com");
    assertEquals(loaded?.accessToken, "sfc_access");
  } finally {
    if (prevHome === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", prevHome);
    if (prevUserProfile === undefined) Deno.env.delete("USERPROFILE");
    else Deno.env.set("USERPROFILE", prevUserProfile);
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("FileCredentialStore: save → load round-trips", async () => {
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    const url = "https://api.example.com";
    assertEquals(await store.load(url), null);
    await store.save(url, creds());
    assertEquals(await store.load(url), creds());
  });
});

Deno.test("FileCredentialStore: keys by deployment, trailing slash normalized", async () => {
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    await store.save("https://a.example.com/", creds({ accessToken: "A" }));
    await store.save("https://b.example.com", creds({ accessToken: "B" }));
    // trailing slash on save + bare on load resolve to the same key
    assertEquals((await store.load("https://a.example.com"))?.accessToken, "A");
    assertEquals((await store.load("https://b.example.com/"))?.accessToken, "B");
  });
});

Deno.test("FileCredentialStore: delete removes only the target deployment", async () => {
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    await store.save("https://a.example.com", creds({ accessToken: "A" }));
    await store.save("https://b.example.com", creds({ accessToken: "B" }));
    await store.delete("https://a.example.com");
    assertEquals(await store.load("https://a.example.com"), null);
    assertEquals((await store.load("https://b.example.com"))?.accessToken, "B");
  });
});

Deno.test("FileCredentialStore: file is created with 0600 perms", async () => {
  if (Deno.build.os === "windows") return; // POSIX perms only
  await withTempFile(async (path) => {
    const store = new FileCredentialStore(path);
    await store.save("https://a.example.com", creds());
    const mode = (await Deno.stat(path)).mode ?? 0;
    assertEquals(mode & 0o777, 0o600);
  });
});

Deno.test("FileCredentialStore: corrupt file is treated as empty (auth never wedges)", async () => {
  await withTempFile(async (path) => {
    await Deno.writeTextFile(path, "}{ not json");
    const store = new FileCredentialStore(path);
    assertEquals(await store.load("https://a.example.com"), null);
    // and a subsequent save still works (overwrites the garbage)
    await store.save("https://a.example.com", creds());
    assertEquals((await store.load("https://a.example.com"))?.accessToken, "sfc_access");
  });
});
