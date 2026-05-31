import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

Deno.test("parseArgs: cloud login", () => {
  assertEquals(parseArgs(["cloud", "login"]), {
    kind: "cloud",
    sub: "login",
    apiUrl: null,
  });
});

Deno.test("parseArgs: cloud login --api-url", () => {
  assertEquals(parseArgs(["cloud", "login", "--api-url", "https://x.convex.site"]), {
    kind: "cloud",
    sub: "login",
    apiUrl: "https://x.convex.site",
  });
});

Deno.test("parseArgs: cloud token (script-facing)", () => {
  assertEquals(parseArgs(["cloud", "token", "--api-url", "https://x.convex.site"]), {
    kind: "cloud",
    sub: "token",
    apiUrl: "https://x.convex.site",
  });
});

Deno.test("parseArgs: cloud logout", () => {
  assertEquals(parseArgs(["cloud", "logout"]), {
    kind: "cloud",
    sub: "logout",
    apiUrl: null,
  });
});

Deno.test("parseArgs: unknown cloud subcommand → unknown", () => {
  assertEquals(parseArgs(["cloud", "wat"]), { kind: "unknown", received: "cloud wat" });
});

Deno.test("parseArgs: bare cloud → unknown", () => {
  assertEquals(parseArgs(["cloud"]), { kind: "unknown", received: "cloud" });
});
