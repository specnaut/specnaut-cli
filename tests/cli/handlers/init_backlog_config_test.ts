import { assertEquals } from "@std/assert";
import { parseGithubRepoFromRemote } from "../../../src/cli/handlers/init_backlog_config.ts";

Deno.test("parseGithubRepoFromRemote reads owner/name off the SSH and HTTPS shapes", () => {
  assertEquals(parseGithubRepoFromRemote("git@github.com:acme/my-app.git"), "acme/my-app");
  assertEquals(parseGithubRepoFromRemote("git@github.com:acme/my-app"), "acme/my-app");
  assertEquals(parseGithubRepoFromRemote("https://github.com/acme/my-app.git"), "acme/my-app");
  assertEquals(parseGithubRepoFromRemote("https://github.com/acme/my-app/"), "acme/my-app");
});

Deno.test("parseGithubRepoFromRemote returns null for another host or a malformed remote", () => {
  assertEquals(parseGithubRepoFromRemote("https://gitlab.example.com/acme/my-app.git"), null);
  assertEquals(parseGithubRepoFromRemote("https://github.com/acme"), null);
  assertEquals(parseGithubRepoFromRemote("not a url"), null);
  assertEquals(parseGithubRepoFromRemote(""), null);
});
