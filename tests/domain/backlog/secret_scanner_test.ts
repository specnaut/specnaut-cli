import { assertEquals } from "@std/assert";
import { scanForSecrets } from "../../../src/domain/backlog/secret_scanner.ts";

Deno.test("scanForSecrets returns empty array for clean body", () => {
  assertEquals(scanForSecrets("Just a normal task description."), []);
});

Deno.test("scanForSecrets catches GitHub PAT (ghp_)", () => {
  const hits = scanForSecrets("key: ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, "github_pat");
});

Deno.test("scanForSecrets catches Stripe secret key (sk_live_)", () => {
  const hits = scanForSecrets("stripe sk_live_51Hxxxxxxxxxxxxxxxxxxxxxx");
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, "stripe_secret");
});

Deno.test("scanForSecrets catches AWS access key", () => {
  const hits = scanForSecrets("AKIAIOSFODNN7EXAMPLE is the AWS id");
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, "aws_access_key");
});

Deno.test("scanForSecrets catches multiple secrets", () => {
  const body = "ghp_abcdefghijklmnopqrstuvwxyz0123456789 and AKIAIOSFODNN7EXAMPLE";
  assertEquals(scanForSecrets(body).length, 2);
});

Deno.test("scanForSecrets reports line numbers", () => {
  const body = "line one\nline two with ghp_abcdefghijklmnopqrstuvwxyz0123456789\nline three";
  const hits = scanForSecrets(body);
  assertEquals(hits[0].line, 2);
});
