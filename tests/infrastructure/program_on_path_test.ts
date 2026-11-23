import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { programOnPath } from "../../src/infrastructure/program_on_path.ts";

/**
 * A program started by its bare name is handed to the spawn as the absolute path of the file the
 * kept PATH entries hold, so the spawn looks nothing up: Windows would also search the working
 * folder. Windows' rules are judged here with the platform passed in and the files stood in for,
 * so every runner checks them; the last case reads a real folder.
 */

/** A stand-in for the file system: these files are programs, nothing else is. */
const holds = (...files: string[]) => (file: string) => files.includes(file);

Deno.test("on POSIX the first entry holding the program wins, in the PATH's order", () => {
  const host = { os: "linux", isProgram: holds("/b/gh", "/c/gh") } as const;
  assertEquals(programOnPath("gh", "/a:/b:/c", host), "/b/gh");
  assertEquals(programOnPath("gh", "/a", host), undefined);
  assertEquals(programOnPath("gh", "", host), undefined);
});

Deno.test("an entry that is empty, relative or dotted is never searched", () => {
  const host = { os: "linux", isProgram: holds("gh", "bin/gh", "/gh", "/b/gh") } as const;
  assertEquals(programOnPath("gh", ":bin:/a/..:/b", host), "/b/gh");
  assertEquals(programOnPath("gh", ":bin:.", host), undefined);
  const win = {
    os: "windows",
    pathext: ".EXE",
    isProgram: holds("gh.EXE", "bin\\gh.EXE"),
  } as const;
  assertEquals(programOnPath("gh", ";bin;.", win), undefined);
});

Deno.test("a name with a separator is a path already, given back as it is", () => {
  const none = holds();
  assertEquals(programOnPath("/bin/sh", "/a", { os: "linux", isProgram: none }), "/bin/sh");
  assertEquals(programOnPath("./x", "/a", { os: "linux", isProgram: none }), "./x");
  const win = { os: "windows", isProgram: none } as const;
  assertEquals(programOnPath("C:\\Git\\git.exe", "C:\\a", win), "C:\\Git\\git.exe");
  assertEquals(programOnPath("tools/gh", "C:\\a", win), "tools/gh");
});

Deno.test("on Windows a bare name is tried with each PATHEXT extension, entry by entry", () => {
  const isProgram = holds("C:\\a\\gh.CMD", "C:\\b\\gh.EXE");
  const host = { os: "windows", pathext: ".COM;.EXE;;.CMD", isProgram } as const;
  assertEquals(programOnPath("gh", "C:\\a;C:\\b", host), "C:\\a\\gh.CMD");
  assertEquals(programOnPath("gh", "C:\\b;C:\\a", host), "C:\\b\\gh.EXE");
  // No PATHEXT: Windows' own default list.
  const unset = { os: "windows", pathext: undefined, isProgram } as const;
  assertEquals(programOnPath("gh", "C:\\b", unset), "C:\\b\\gh.EXE");
});

Deno.test("on Windows a name whose extension PATHEXT lists is tried as it is, alone", () => {
  const isProgram = holds("C:\\a\\gh.exe", "C:\\a\\gh.exe.EXE", "C:\\a\\gh.v2.EXE");
  const host = { os: "windows", pathext: ".com;.exe", isProgram } as const;
  assertEquals(programOnPath("gh.exe", "C:\\a", host), "C:\\a\\gh.exe");
  // An extension PATHEXT does not list is part of the name.
  const upper = { ...host, pathext: ".EXE" };
  assertEquals(programOnPath("gh.v2", "C:\\a", upper), "C:\\a\\gh.v2.EXE");
});

Deno.test("on Windows a PATHEXT entry other than a dot and letters or digits is never tried", () => {
  // `..` would make `gh..`, which Windows opens as `gh`; a separator would leave the entry.
  const isProgram = holds("C:\\a\\bin\\gh..", "C:\\a\\b\\x", "C:\\a\\bin\\gh.EXE");
  const lookup = (pathext: string) =>
    programOnPath("gh", "C:\\a\\bin", { os: "windows", pathext, isProgram });
  for (const entry of ["..", "\\..\\..\\b\\x", "/../../b/x"]) {
    assertEquals(lookup(entry), undefined, entry);
  }
  assertEquals(lookup("..;.EXE"), "C:\\a\\bin\\gh.EXE");
});

Deno.test("a file found outside the entry searched is never the program", () => {
  // `..` names the entry's parent: a stand-in that calls it a program is still not believed.
  const host = { os: "linux", isProgram: holds("/a", "/a/b/..") } as const;
  assertEquals(programOnPath("..", "/a/b", host), undefined);
});

Deno.test({
  name: "on POSIX a program is an executable file: a folder or a plain file of the name is not",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const tmp = await Deno.realPath(await Deno.makeTempDir({ prefix: "program-on-path-" }));
    try {
      const [dir, plain, exec] = ["dir", "plain", "exec"].map((d) => join(tmp, d));
      await Deno.mkdir(join(dir, "tool"), { recursive: true });
      await Deno.mkdir(plain);
      await Deno.writeTextFile(join(plain, "tool"), "", { mode: 0o644 });
      await Deno.mkdir(exec);
      await Deno.writeTextFile(join(exec, "tool"), "#!/bin/sh\n", { mode: 0o755 });
      const path = [dir, plain, join(tmp, "missing"), exec].join(":");
      assertEquals(programOnPath("tool", path), join(exec, "tool"));
      assertEquals(programOnPath("tool", [dir, plain].join(":")), undefined);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
});
