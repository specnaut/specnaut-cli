import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { declaredToolchain } from "../../src/domain/gates_toolchain.ts";
import { gateProject } from "../scripts/run_gate_fixture.ts";

/**
 * The toolchain folders `gates.yml` declares, read by `review start` (here) and by
 * `run-gate.sh --parse-toolchain` (the shell), which must agree on every file.
 */

const HOME = "/home/dev";

const FILES: Record<string, string> = {
  plain: "toolchain:\n  - /opt/go/bin\n  - ~/.deno/bin\n",
  quoted: `toolchain:\n  - "/opt/a b/bin"\n  - '~/.local/bin'\n  -   /usr/x   \n`,
  amid:
    "fast_gate:\n  - echo a\ntoolchain:\n  # a comment\n\n  - /opt/one\nfull_gate:\n  - /opt/no\n",
  refused: "toolchain:\n  - relative/bin\n  - ~user/bin\n  - /opt/a:/opt/b\n  - ~\n  - /ok\n",
  none: "fast_gate:\n  - /opt/not-a-folder\n",
  empty: "toolchain: []\n",
  // A file saved with Windows line ends: every line ends in a carriage return.
  crlf: [
    "fast_gate:",
    "  - echo a",
    "toolchain:",
    "  # a comment",
    "",
    '  - "/opt/a b/bin"',
    "  - ~/.deno/bin",
    "  -   /usr/x   ",
    "full_gate:",
    "  - /opt/no",
    "",
  ].join("\r\n"),
};

const EXPECTED: Record<string, string[]> = {
  plain: ["/opt/go/bin", `${HOME}/.deno/bin`],
  quoted: ["/opt/a b/bin", `${HOME}/.local/bin`, "/usr/x"],
  amid: ["/opt/one"],
  refused: ["/ok"],
  none: [],
  empty: [],
  crlf: ["/opt/a b/bin", `${HOME}/.deno/bin`, "/usr/x"],
};

Deno.test("declaredToolchain: the toolchain list, ~/ against the home, a non-folder dropped", () => {
  for (const [name, text] of Object.entries(FILES)) {
    assertEquals(declaredToolchain(text, HOME), EXPECTED[name], name);
  }
  assertEquals(declaredToolchain(FILES.plain, null), ["/opt/go/bin"], "no home, no ~/ folder");
  // An empty HOME is no home: `~/.deno/bin` is never read as `/.deno/bin`.
  assertEquals(declaredToolchain(FILES.plain, ""), ["/opt/go/bin"], "an empty home");
});

/** What `run-gate.sh --parse-toolchain` prints for `file`, its HOME `home`, or unset (`null`). */
async function shellToolchain(root: string, file: string, home: string | null) {
  const out = await new Deno.Command("bash", {
    args: [join(root, ".specnaut/scripts/bash/run-gate.sh"), "fast", "--parse-toolchain", file],
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", ...(home === null ? {} : { HOME: home }) },
    stdout: "piped",
  }).output();
  return [out.code, new TextDecoder().decode(out.stdout).split("\n").filter(Boolean)];
}

Deno.test({
  name: "run-gate.sh --parse-toolchain reads every file as declaredToolchain does",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const root = await gateProject();
    for (const [name, text] of Object.entries(FILES)) {
      const file = join(root, `${name}.yml`);
      await Deno.writeTextFile(file, text);
      for (const home of [HOME, "", null]) {
        const shell = await shellToolchain(root, file, home);
        assertEquals(shell, [0, declaredToolchain(text, home)], `${name}, HOME ${home}`);
      }
    }
  },
});
