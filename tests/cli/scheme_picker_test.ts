import { assertEquals } from "@std/assert";
import { DEFAULT_VERSION_SCHEME, pickVersionScheme } from "../../src/cli/scheme_picker.ts";

function fakeIO(lines: ReadonlyArray<string>): {
  io: {
    readLine: () => string | null;
    log: (s: string) => void;
    errLog: (s: string) => void;
  };
  logs: string[];
  errs: string[];
} {
  const logs: string[] = [];
  const errs: string[] = [];
  let i = 0;
  return {
    io: {
      readLine: () => (i < lines.length ? lines[i++] : null),
      log: (s) => logs.push(s),
      errLog: (s) => errs.push(s),
    },
    logs,
    errs,
  };
}

Deno.test("pickVersionScheme returns the suggestion on bare Enter", () => {
  const { io } = fakeIO([""]);
  assertEquals(pickVersionScheme(io, "date"), "date");
});

Deno.test("pickVersionScheme falls back to DEFAULT_VERSION_SCHEME without a suggestion", () => {
  const { io } = fakeIO([""]);
  assertEquals(pickVersionScheme(io), DEFAULT_VERSION_SCHEME);
});

Deno.test("pickVersionScheme accepts numeric choice 1 (semver)", () => {
  const { io } = fakeIO(["1"]);
  assertEquals(pickVersionScheme(io), "semver");
});

Deno.test("pickVersionScheme accepts numeric choice 2 (date)", () => {
  const { io } = fakeIO(["2"]);
  assertEquals(pickVersionScheme(io), "date");
});

Deno.test("pickVersionScheme re-prompts on invalid input", () => {
  const { io, errs } = fakeIO(["banana", "2"]);
  assertEquals(pickVersionScheme(io), "date");
  assertEquals(errs.length, 1);
  assertEquals(errs[0].includes("invalid choice"), true);
});
