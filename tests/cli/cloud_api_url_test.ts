import { assertEquals } from "@std/assert";
import { resolveApiUrl } from "../../src/cli/handlers/cloud_api_url.ts";
import { DEFAULT_CLOUD_API_URL } from "../../src/domain/cloud/cloud_config.ts";

/** Which deployment a `cloud` command talks to, and the source the login discloses (#400). */

/** `fn` run from an empty folder, so no project config is found. */
async function inEmptyFolder<T>(fn: () => Promise<T>): Promise<T> {
  const [dir, before] = [await Deno.makeTempDir({ prefix: "cloud-url-" }), Deno.cwd()];
  Deno.chdir(dir);
  try {
    return await fn();
  } finally {
    Deno.chdir(before);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a flag names the deployment; with none and no config, the default does", async () => {
  const flagged = await resolveApiUrl("https://api.example.com/");
  assertEquals(flagged?.source, "flag");
  assertEquals(await inEmptyFolder(() => resolveApiUrl(null)), {
    url: DEFAULT_CLOUD_API_URL,
    source: "default",
  });
});

Deno.test("a flag that is not a plain URL is refused, its reason said on stderr", async () => {
  const said: string[] = [];
  const error = console.error;
  console.error = (line: string) => said.push(line);
  try {
    assertEquals(await resolveApiUrl("http://api.example.com"), null);
  } finally {
    console.error = error;
  }
  assertEquals(said.length, 1);
  assertEquals(said[0].includes("error: "), true, said[0]);
});
