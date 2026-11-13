import { assertEquals } from "@std/assert";
import { resolveApiUrl } from "../../src/cli/handlers/cloud_api_url.ts";
import { DEFAULT_CLOUD_API_URL } from "../../src/domain/cloud/cloud_config.ts";

/** Which deployment a `cloud` command talks to, and the source the login discloses (#400). */

/** `fn` run from a folder of its own, holding `config` as its backlog config when given. */
async function inEmptyFolder<T>(fn: () => Promise<T>, config?: string): Promise<T> {
  const [dir, before] = [await Deno.makeTempDir({ prefix: "cloud-url-" }), Deno.cwd()];
  if (config !== undefined) {
    await Deno.mkdir(`${dir}/.specnaut`);
    await Deno.writeTextFile(`${dir}/.specnaut/backlog-config.yml`, config);
  }
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

Deno.test("with no flag, the project config's api_url is used, its source said to be the config", async () => {
  const config = "backend: cloud\napi_url: https://cloud.example.com\nproject_key: ACME\n";
  const resolved = await inEmptyFolder(() => resolveApiUrl(null), config);
  assertEquals(resolved?.source, "config");
  assertEquals(resolved?.url.startsWith("https://cloud.example.com"), true, resolved?.url);
});

Deno.test("a config api_url over plain http is refused, saying why", async () => {
  const said: string[] = [];
  const error = console.error;
  console.error = (line: string) => said.push(line);
  try {
    const config = "backend: cloud\napi_url: http://cloud.example.com\n";
    assertEquals(await inEmptyFolder(() => resolveApiUrl(null), config), null);
  } finally {
    console.error = error;
  }
  assertEquals(said.length, 1);
  assertEquals(said[0].includes("plain http reaches a loopback host only"), true, said[0]);
});
