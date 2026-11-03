import { assertEquals } from "@std/assert";
import { parseCloudConfig, renderCloudConfig } from "../../src/domain/cloud/cloud_config.ts";

Deno.test("renderCloudConfig: backend + coordinates, never a secret", () => {
  const yaml = renderCloudConfig("https://api.example.com", "CLOUD");
  assertEquals(yaml.includes("backend: cloud"), true);
  assertEquals(yaml.includes("https://api.example.com"), true);
  assertEquals(yaml.includes("CLOUD"), true);
  assertEquals(yaml.includes("api_token"), false);
});

Deno.test("render → parse round-trips api_url + project_key", () => {
  assertEquals(parseCloudConfig(renderCloudConfig("https://api.example.com", "CLOUD")), {
    apiUrl: "https://api.example.com",
    projectKey: "CLOUD",
  });
});

Deno.test("empty stub parses to empty coordinates (pre-login state)", () => {
  // The rendered stub's `remote:` block is commented out, so it round-trips to
  // exactly the prior shape — no `remote` key (backward compatible, #357).
  assertEquals(parseCloudConfig(renderCloudConfig()), { apiUrl: "", projectKey: "" });
});

Deno.test("an explicit remote: block parses into the config (#357)", () => {
  const text = [
    "backend: cloud",
    'api_url: "https://api.example.com"',
    'project_key: "CLOUD"',
    "remote:",
    "  enabled: true",
    "  await_timeout_s: 600",
    "  poll_interval_s: 10",
    "",
  ].join("\n");
  assertEquals(parseCloudConfig(text), {
    apiUrl: "https://api.example.com",
    projectKey: "CLOUD",
    remote: { enabled: true, awaitTimeoutS: 600, pollIntervalS: 10 },
  });
});

Deno.test("an api_url that is not a string is a bad one, not an absent one", () => {
  assertEquals(parseCloudConfig("api_url: 1234\nproject_key: K\n")?.apiUrl, "1234");
  assertEquals(parseCloudConfig("api_url: []\nproject_key: K\n")?.apiUrl, "[]");
  assertEquals(parseCloudConfig("api_url: {a: 1}\nproject_key: K\n")?.apiUrl, '{"a":1}');
  assertEquals(parseCloudConfig("project_key: K\n")?.apiUrl, "");
  assertEquals(parseCloudConfig("api_url: null\nproject_key: K\n")?.apiUrl, "");
});

Deno.test("malformed YAML or a non-mapping reads as not Cloud-linked", () => {
  assertEquals(parseCloudConfig("api_url: [unclosed"), null);
  assertEquals(parseCloudConfig("just a scalar"), null);
  assertEquals(parseCloudConfig(""), null);
});
