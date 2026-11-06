import { DELIMITER, fromFileUrl, join } from "@std/path";
import { run } from "./git_sandbox.ts";

/**
 * A backend's close-shipped.sh installed beside stand-ins for the backlog
 * scripts it calls, each logging its call to calls.log and failing on demand
 * (close_shipped_test.ts).
 */

const SCRIPTS = fromFileUrl(new URL("../../templates/core/skills/task/scripts/", import.meta.url));

export interface Board {
  /** issue → cascade-check exit (12 = closed). */
  closed?: Record<string, number>;
  /** the numbers the sweep reports DRIFTED. */
  drifted?: string[];
  /** the calls that fail, as logged: `move.sh 7 Done`, `move-batch.sh`, `sweep-closed.sh`. */
  fail?: string[];
}

export async function backlog(
  backend: string,
  { closed = {}, drifted = [], fail = [] }: Board = {},
) {
  const dir = await Deno.makeTempDir({ prefix: `specnaut-close-${backend}-` });
  // The installed layout: gitlab's _config.sh finds the project three levels up.
  const scripts = join(dir, ".specnaut", "scripts", "backlog");
  await Deno.mkdir(join(dir, "bin"), { recursive: true });
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.copyFile(
    join(SCRIPTS, backend, "close-shipped.sh"),
    join(scripts, "close-shipped.sh"),
  );
  // The shared body every backend's copy sources, installed beside it (cli#711).
  await Deno.copyFile(join(SCRIPTS, "_close_shipped.sh"), join(scripts, "_close_shipped.sh"));
  const failing = fail.map((f) => `"${f}"*) exit 1 ;;`).join(" ");
  // Each stub logs its call (to calls.log, in the scripts' directory) and fails on demand.
  const stub = (name: string, body: string) =>
    Deno.writeTextFile(
      join(scripts, name),
      `#!/usr/bin/env bash\necho "${name} $*" >> calls.log\ncase "${name} $*" in ${failing} esac\n${body}\n`,
    );
  const cases = Object.entries(closed).map(([n, c]) => `${n}) exit ${c} ;;`).join(" ");
  await stub("cascade-check.sh", `case $1 in ${cases} *) exit 3 ;; esac`);
  await stub("move.sh", "exit 0");
  await stub("move-batch.sh", "exit 0");
  if (backend === "gitlab") {
    for (const f of ["sweep-closed.sh", "_config.sh"]) {
      await Deno.copyFile(join(SCRIPTS, backend, f), join(scripts, f));
    }
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      "host: https://gitlab.example.com\nproject_id: acme/my-app\n",
    );
    const issues = drifted.map((d) =>
      `{"iid":${d},"labels":["Status::In progress"],"closed_at":"2999-01-01T00:00:00Z"}`
    );
    // The forge, reached through PATH. A failing sweep is a failing read, as on a real board.
    await Deno.writeTextFile(
      join(dir, "bin", "glab"),
      `#!/usr/bin/env bash\n${fail.includes("sweep-closed.sh") ? "exit 1" : ""}
case "$*" in *--closed*) echo '[${
        issues.join(",")
      }]' ;; *) echo '[{"iid":99,"labels":["Status::Ready"]}]' ;; esac\n`,
    );
    await Deno.chmod(join(dir, "bin", "glab"), 0o755);
  } else {
    const lines = drifted.map((d) => `echo "DRIFTED  ${d} In progress"`).join("\n");
    await stub(
      "sweep-closed.sh",
      `${lines}\necho "scanned 9, drifted ${drifted.length}, reopened 0"`,
    );
  }
  return {
    scripts,
    // By bare name from its own directory: the sibling lookup must not depend on the path's form.
    run: (...args: string[]) =>
      run("bash", ["close-shipped.sh", ...args], scripts, {
        PATH: `${join(dir, "bin")}${DELIMITER}${Deno.env.get("PATH")}`,
      }),
    calls: async () =>
      (await Deno.readTextFile(join(scripts, "calls.log")).catch(() => "")).trim().split("\n")
        .filter(Boolean),
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}
