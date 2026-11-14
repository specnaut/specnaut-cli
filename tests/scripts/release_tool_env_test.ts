import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * `rcodesign` reads every `RCODESIGN_*` environment variable as a key of its own configuration
 * and refuses a key it does not know. The v9.4.0 tag's signing job exported the tool's download
 * URL and digest as `RCODESIGN_URL` / `RCODESIGN_SHA256`, so `rcodesign sign` stopped at
 * `UnknownField("sha256")` before signing anything, and nothing was published. No env value of
 * release.yml, at the workflow, job or step level, may carry that prefix.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const TOOL_CONFIG_PREFIX = "RCODESIGN_";

type Env = Record<string, unknown>;
type Workflow = { env?: Env; jobs: Record<string, { env?: Env; steps?: { env?: Env }[] }> };

function envKeys(wf: Workflow): string[] {
  const scopes = [
    wf.env,
    ...Object.values(wf.jobs).flatMap((j) => [j.env, ...(j.steps ?? []).map((s) => s.env)]),
  ];
  return scopes.flatMap((env) => Object.keys(env ?? {}));
}

Deno.test("release.yml exports no variable rcodesign would read as its own configuration", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as Workflow;
  const keys = envKeys(wf);
  assertEquals(
    keys.includes("MACOS_TEAM_ID"),
    true,
    "the env walk found none of release.yml's variables",
  );
  assertEquals(keys.filter((k) => k.startsWith(TOOL_CONFIG_PREFIX)), []);
});

type Step = { name?: string; run?: string };

Deno.test("release.yml drops the password file's line feed and checks it opens the certificate before signing", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  const steps = wf.jobs["sign-macos"].steps;
  const at = (pred: (s: Step) => boolean) => steps.findIndex(pred);
  const fetch = at((s) => (s.run ?? "").includes("secretmanager.googleapis.com"));
  const check = at((s) => (s.run ?? "").includes("openssl pkcs12"));
  const sign = at((s) => (s.run ?? "").includes("rcodesign sign"));
  // A password added from a text file ends in a line feed rcodesign would read as part of it.
  assertEquals(/tr -d '\\r\\n' < "\$pw"/.test(steps[fetch].run ?? ""), true);
  assertEquals(fetch < check && check < sign, true, `fetch ${fetch}, check ${check}, sign ${sign}`);
});

Deno.test("release.yml re-encrypts the certificate with 3DES before rcodesign reads it, and leaves no key in clear", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  const steps = wf.jobs["sign-macos"].steps;
  const check = steps.find((s) => (s.run ?? "").includes("openssl pkcs12"))?.run ?? "";
  // rcodesign reads an AES (PBES2) certificate as a wrong password: only 3DES and a SHA-1 MAC.
  for (const option of ["-certpbe PBE-SHA1-3DES", "-keypbe PBE-SHA1-3DES", "-macalg sha1"]) {
    assertEquals(check.replace(/\\\n\s*/g, "").includes(option), true, `no ${option}`);
  }
  assertEquals(
    /mv "\$p12\.3des" "\$p12"/.test(check),
    true,
    "the re-encrypted copy is not the one signed",
  );
  assertEquals(
    /trap 'rm -f "\$p12\.pem"' EXIT/.test(check),
    true,
    "the clear key outlives a failure",
  );
  assertEquals(/umask 077/.test(check), true, "the clear key is readable by others");
  // The repository is public, and so are its logs: a key decrypted to stdout would be printed.
  const clear = check.split("\n").filter((l) => /openssl pkcs12\b.*-nodes/.test(l));
  assertEquals(clear.length > 0, true, "no step decrypts the certificate");
  for (const line of clear) {
    assertEquals(/-out "\$p12\.pem"/.test(line), true, `the clear key goes to the log: ${line}`);
    assertEquals(/-clcerts/.test(line), true, `a chain certificate could be signed with: ${line}`);
  }
});

Deno.test("release.yml waits for notarization longer than rcodesign's 10-minute default", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    jobs: Record<string, { steps: Step[]; "timeout-minutes"?: number }>;
  };
  const job = wf.jobs["sign-macos"];
  const notarize = job.steps.find((s) => (s.run ?? "").includes("rcodesign notary-submit"))?.run;
  const wait = Number(/--max-wait-seconds (\d+)/.exec(notarize ?? "")?.[1] ?? 0);
  // A first submission was still "InProgress" at Apple when the 600 s default ran out.
  assertEquals(wait >= 3600, true, `notarization waits ${wait}s`);
  // Both binaries are waited on in turn, inside the job's limit (GitHub's default is 6 hours).
  assertEquals(
    2 * wait < (job["timeout-minutes"] ?? 360) * 60,
    true,
    "the job ends before its waits",
  );
});
