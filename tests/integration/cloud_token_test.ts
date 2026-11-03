import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { DENO_DIR } from "./spawn_env.ts";
import { FileCredentialStore } from "../../src/infrastructure/credential_store.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { DENO_DIR, ...env },
    clearEnv: true,
    stdin: "null",
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

Deno.test("`cloud token` echoes SPECNAUT_CLOUD_TOKEN (headless escape hatch)", async () => {
  const r = await runSpecnaut(
    ["cloud", "token", "--api-url", "https://api.example.com"],
    {
      SPECNAUT_CLOUD_TOKEN: "sfc_headless_xyz",
      SPECNAUT_CLOUD_API_URL: "https://api.example.com/",
      PATH: Deno.env.get("PATH") ?? "",
    },
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim(), "sfc_headless_xyz");
});

// monorepo#44 — the headless token is bound to no deployment: it is handed over
// for the canonical endpoint or the one the environment names, never for a URL
// a repository chose (its api_url, or a command line it runs).
Deno.test("`cloud token` hands the headless token over for the canonical endpoint", async () => {
  const r = await runSpecnaut(
    ["cloud", "token", "--api-url", "https://api.specnaut.com/"],
    { SPECNAUT_CLOUD_TOKEN: "sfc_headless_xyz", PATH: Deno.env.get("PATH") ?? "" },
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim(), "sfc_headless_xyz");
});

Deno.test("`cloud token` refuses the headless token for a deployment the environment did not name", async () => {
  const home = await Deno.makeTempDir({ prefix: "specnaut-nohome-" });
  try {
    for (
      const url of [
        "https://api.example.com",
        "http://api.specnaut.com",
        "https://api.specnaut.com.evil.test",
      ]
    ) {
      const r = await runSpecnaut(
        ["cloud", "token", "--api-url", url],
        { HOME: home, SPECNAUT_CLOUD_TOKEN: "sfc_headless_xyz", PATH: Deno.env.get("PATH") ?? "" },
      );
      assertEquals(r.code, 1, url);
      assertEquals(r.stdout.includes("sfc_headless_xyz"), false, url);
      assertStringIncludes(r.stderr, "is not sent to", url);
      assertStringIncludes(r.stderr, "not authenticated", url);
      // The env's token was just refused: setting it is not the way out.
      assertEquals(r.stderr.includes("(or set SPECNAUT_CLOUD_TOKEN)"), false, r.stderr);
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

// cli#736 — one refusal policy: warn, then the user's own login for that deployment.
// HOME alone places the store on every OS, Windows included, because the store reads
// HOME first. The cross-smoke (windows-latest) job runs this test.
Deno.test("`cloud token` refused the headless token: it warns, then uses the login stored for that URL", async () => {
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  const url = "https://cloud.example.test";
  try {
    // Backslashes on Windows, as the store must accept: its own default path uses "/".
    await new FileCredentialStore(join(home, ".specnaut", "credentials.json")).save(url, {
      accessToken: "stored-login",
      refreshToken: "r",
      accessExpiresAt: 8.64e15,
    });
    const stored = await Array.fromAsync(Deno.readDir(join(home, ".specnaut")));
    assertEquals(stored.map((e) => e.name), ["credentials.json"]);
    const r = await runSpecnaut(
      ["cloud", "token", "--api-url", url],
      { HOME: home, SPECNAUT_CLOUD_TOKEN: "sfc_headless_xyz", PATH: Deno.env.get("PATH") ?? "" },
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout.trim(), "stored-login");
    assertStringIncludes(r.stderr, "is not sent to");
    assertEquals(r.stderr.includes("sfc_headless_xyz"), false, r.stderr);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("`cloud token` with no env + no stored creds → exit 1 with guidance", async () => {
  // HOME points at an empty temp dir so there's no credentials file to find.
  const home = await Deno.makeTempDir({ prefix: "specnaut-nohome-" });
  try {
    const r = await runSpecnaut(
      ["cloud", "token", "--api-url", "https://api.example.com"],
      { HOME: home, PATH: Deno.env.get("PATH") ?? "" },
    );
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "cloud login");
    // The one command that reads the variable may offer it.
    assertStringIncludes(r.stderr, "SPECNAUT_CLOUD_TOKEN");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

// cli#737 — only some commands read the variable, and each says the truth about it.
Deno.test("`cloud orgs` and `cloud board` logged out: log in, and the variable would not help", async () => {
  const home = await Deno.makeTempDir({ prefix: "specnaut-nohome-" });
  try {
    await Deno.mkdir(join(home, ".specnaut"));
    await Deno.writeTextFile(
      join(home, ".specnaut", "backlog-config.yml"),
      "backend: cloud\nproject_key: K\n",
    );
    for (const sub of ["orgs", "board"]) {
      // The token would be accepted here: only a command that ignores it says log in.
      const url = "https://api.example.com";
      const env = {
        HOME: home,
        SPECNAUT_CLOUD_TOKEN: "x",
        SPECNAUT_CLOUD_API_URL: url,
        PATH: Deno.env.get("PATH") ?? "",
      };
      const r = await runSpecnaut(["cloud", sub, "--api-url", url], env, home);
      assertEquals(r.code, 1, r.stderr);
      assertStringIncludes(r.stderr, "cloud login");
      assertStringIncludes(r.stderr, "does not read SPECNAUT_CLOUD_TOKEN");
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("`cloud login` with no terminal says which commands the variable serves", async () => {
  const r = await runSpecnaut(["cloud", "login"], { PATH: Deno.env.get("PATH") ?? "" });
  assertEquals(r.code, 2, r.stderr);
  assertStringIncludes(r.stderr, "`cloud orgs` and `cloud board` need this login");
});

Deno.test("`cloud token` prints only a well-formed token, from the environment too", async () => {
  const r = await runSpecnaut(["cloud", "token", "--api-url", "https://api.specnaut.com"], {
    SPECNAUT_CLOUD_TOKEN: "a\x1bb",
    PATH: Deno.env.get("PATH") ?? "",
  });
  assertEquals([r.code, r.stdout], [1, ""], r.stderr);
});

Deno.test("`cloud token` prints only a well-formed stored token", async () => {
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  const url = "https://cloud.example.test";
  try {
    await new FileCredentialStore(join(home, ".specnaut", "credentials.json")).save(url, {
      accessToken: "a\x1bb",
      refreshToken: "r",
      accessExpiresAt: 8.64e15,
    });
    const r = await runSpecnaut(["cloud", "token", "--api-url", url], {
      HOME: home,
      PATH: Deno.env.get("PATH") ?? "",
    });
    assertEquals([r.code, r.stdout], [1, ""], r.stderr);
    assertStringIncludes(r.stderr, "not usable");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
