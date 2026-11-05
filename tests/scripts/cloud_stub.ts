import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SERVER = fromFileUrl(new URL("./cloud_stub_server.ts", import.meta.url));
export const CLOUD = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/cloud", import.meta.url),
);
const BASH = fromFileUrl(new URL("../../templates/core/specnaut/scripts/bash", import.meta.url));
export const TOKEN = "tok-Secret.123";

export type StubRequest = { path: string; authorization: string | null; extra: string | null };

/** A file's text, or "" when it does not exist yet. Any other failure is a failure. */
async function readIfThere(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  }
}

/** The stub server, for the length of `fn`. */
export async function withServer(
  fn: (port: string, requests: () => Promise<StubRequest[]>) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "cloud-stub-" });
  const child = new Deno.Command("deno", {
    args: ["run", "--no-config", "--allow-net=127.0.0.1", `--allow-write=${dir}`, SERVER, dir],
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    let port = "";
    for (let i = 0; i < 300 && !port; i++) {
      port = await readIfThere(join(dir, "port"));
      if (!port) await new Promise((r) => setTimeout(r, 100));
    }
    assertEquals(port !== "", true, "the stub server did not start");
    await fn(port, async () => {
      const log = await readIfThere(join(dir, "requests.log"));
      return log.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    });
  } finally {
    child.kill();
    await child.status;
    await Deno.remove(dir, { recursive: true });
  }
}

export type RunOptions = {
  token?: string;
  curlrc?: string;
  env?: Record<string, string>;
  jqRefusesFilter?: boolean;
};

/** A project holding the scripts, a config, and stand-ins for curl and specnaut. */
async function layOut(dir: string, apiUrl: string, opts: RunOptions) {
  const scripts = join(dir, ".specnaut", "scripts", "backlog");
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(join(dir, ".specnaut", "scripts", "bash"));
  await Deno.mkdir(join(dir, ".bin"));
  for await (const f of Deno.readDir(CLOUD)) {
    await Deno.copyFile(join(CLOUD, f.name), join(scripts, f.name));
  }
  for await (const f of Deno.readDir(BASH)) {
    if (f.isFile) {
      await Deno.copyFile(join(BASH, f.name), join(dir, ".specnaut", "scripts", "bash", f.name));
    }
  }
  await Deno.writeTextFile(
    join(dir, ".specnaut", "backlog-config.yml"),
    `backend: cloud\napi_url: "${apiUrl}"\nproject_key: K\n`,
  );
  await Deno.writeTextFile(join(dir, ".curlrc"), opts.curlrc ?? "");
  await Deno.writeTextFile(
    join(dir, ".bin", "curl"),
    '#!/usr/bin/env bash\nprintf "ARGS %s\\n" "$* env:${API_TOKEN:-}" >> curl.log\nexec "$REAL_CURL" "$@"\n',
  );
  if (opts.jqRefusesFilter) {
    await Deno.writeTextFile(
      join(dir, ".bin", "jq"),
      '#!/usr/bin/env bash\ncase "$*" in *"def printable"*) exit 3 ;; esac\nexec "$REAL_JQ" "$@"\n',
    );
  }
  await Deno.writeTextFile(join(dir, ".token"), `${opts.token ?? TOKEN}\n`);
  await Deno.writeTextFile(join(dir, ".bin", "specnaut"), "#!/usr/bin/env bash\ncat .token\n");
}

/** Run one script in a fresh project. */
export async function run(
  script: string,
  args: string[],
  apiUrl: string,
  opts: RunOptions = {},
): Promise<{ code: number; out: string; curlLog: string }> {
  const dir = await Deno.makeTempDir({ prefix: "cloud-curl-" });
  try {
    await layOut(dir, apiUrl, opts);
    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [
        "-c",
        'export REAL_CURL=$(command -v curl) REAL_JQ=$(command -v jq) HOME="$PWD" PATH="$PWD/.bin:$PATH"; ' +
        'chmod +x .bin/*; s=$1; shift; exec bash ".specnaut/scripts/backlog/$s" "$@"',
        "driver",
        script,
        ...args,
      ],
      cwd: dir,
      env: opts.env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    return {
      code,
      out: dec.decode(stdout) + dec.decode(stderr),
      curlLog: await readIfThere(join(dir, "curl.log")),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
