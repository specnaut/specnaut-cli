import { assertEquals } from "@std/assert";
import { loginNeedsTrustConfirm, urlSourceLabel } from "../../src/cli/handlers/cloud_handler.ts";

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
