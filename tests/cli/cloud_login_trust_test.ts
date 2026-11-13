import { assertEquals } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { type ApiUrlSource, urlSourceLabel } from "../../src/cli/handlers/cloud_api_url.ts";
import { loginNeedsTrustConfirm, trustedTarget } from "../../src/cli/handlers/cloud_login_trust.ts";
import type { CredentialStore } from "../../src/domain/cloud/credentials.ts";

Deno.test("urlSourceLabel maps each source to a human label (#400)", () => {
  assertEquals(urlSourceLabel("flag"), "--api-url flag");
  assertEquals(
    urlSourceLabel("config"),
    "project config (.specnaut/backlog-config.yml)",
  );
  assertEquals(urlSourceLabel("default"), "Specnaut Cloud (default)");
});

Deno.test("loginNeedsTrustConfirm fires only for a config URL with no existing creds (#400)", () => {
  // The phishing window: a config-supplied URL the user never logged into.
  assertEquals(loginNeedsTrustConfirm("config", false), true);
  // Already authenticated here before → trusted, no prompt.
  assertEquals(loginNeedsTrustConfirm("config", true), false);
  // Explicit user act (typed flag) is always trusted.
  assertEquals(loginNeedsTrustConfirm("flag", false), false);
  assertEquals(loginNeedsTrustConfirm("flag", true), false);
  // The CLI-shipped default endpoint is baked into the signed binary, not
  // attacker-controlled — always trusted, no confirmation.
  assertEquals(loginNeedsTrustConfirm("default", false), false);
  assertEquals(loginNeedsTrustConfirm("default", true), false);
});

/** A store holding a login for `known` only, recording each URL it is asked for. */
function storeKnowing(known: string | null, loads: string[]): CredentialStore {
  const creds = { accessToken: "a", refreshToken: "r", accessExpiresAt: 0 };
  return {
    kind: "file",
    load: (url) => (loads.push(url), Promise.resolve(url === known ? creds : null)),
    save: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

/** `trustedTarget` with the user answering `answer`; what it decided, asked and printed. */
async function gate(source: ApiUrlSource, answer: string | null, known: string | null = null) {
  const [loads, asked, errors] = [[], [], []] as string[][];
  const [prompt, error, log] = [globalThis.prompt, console.error, console.log];
  globalThis.prompt = (message?: string) => (asked.push(message ?? ""), answer);
  console.error = (line: string) => errors.push(line);
  console.log = () => {};
  try {
    const url = "https://cloud.example.com";
    const trusted = await trustedTarget({ url, source }, storeKnowing(known, loads));
    return { trusted, loads, asked: asked.length, errors: errors.map((e) => stripAnsiCode(e)) };
  } finally {
    [globalThis.prompt, console.error, console.log] = [prompt, error, log];
  }
}

Deno.test("trustedTarget: a config URL never logged into goes ahead on y or yes only", async () => {
  for (const yes of ["y", "YES", " Yes "]) {
    assertEquals(await gate("config", yes), {
      trusted: true,
      loads: ["https://cloud.example.com"],
      asked: 1,
      errors: [],
    });
  }
  for (const no of ["", null, "n", "no"]) {
    const refused = await gate("config", no);
    assertEquals([refused.trusted, refused.asked], [false, 1], `answer ${no}`);
    assertEquals(refused.errors, ["aborted — login cancelled."]);
  }
});

Deno.test("trustedTarget: a known config URL, a flag or the default never ask", async () => {
  const known = await gate("config", "n", "https://cloud.example.com");
  assertEquals([known.trusted, known.asked], [true, 0]);
  // Only a config source reads the store: anything else would prompt the keychain for nothing.
  for (const source of ["flag", "default"] as const) {
    assertEquals(await gate(source, "n"), { trusted: true, loads: [], asked: 0, errors: [] });
  }
});
