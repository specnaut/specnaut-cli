import { assertEquals } from "@std/assert";
import {
  DEFAULT_SPEC_BACKEND,
  pickSpecBackend,
  pickSpecBackendInteractive,
} from "../../src/cli/spec_picker.ts";
import type { SelectIO } from "../../src/cli/select.ts";

// Spec 020 / SC-001 — the init spec-backend picker. Mirrors backlog_picker_test:
// Enter → recommended default (cloud); numeric pick → chosen; invalid re-prompts.

function scriptedIO(reads: ReadonlyArray<Uint8Array | null>): SelectIO {
  const queue = [...reads];
  return {
    write: () => {},
    readBytes: () => {
      const next = queue.shift();
      return Promise.resolve(next === undefined ? null : next);
    },
    teardown: () => {},
  };
}

function fakeIO(answers: ReadonlyArray<string | null>) {
  const queue = [...answers];
  const log: string[] = [];
  const errLog: string[] = [];
  return {
    io: {
      readLine: () => queue.shift() ?? null,
      log: (s: string) => log.push(s),
      errLog: (s: string) => errLog.push(s),
    },
    log,
    errLog,
  };
}

Deno.test("pickSpecBackend defaults to cloud on empty input", () => {
  const { io, log } = fakeIO([""]);
  assertEquals(pickSpecBackend(io), "cloud");
  assertEquals(DEFAULT_SPEC_BACKEND, "cloud");
  const all = log.join("\n");
  // Cloud is listed first, marked recommended (default), with a benefit note;
  // local remains a first-class listed choice.
  assertEquals(all.includes("SpecNaut Cloud"), true);
  assertEquals(all.includes("recommended (default)"), true);
  assertEquals(all.includes("Local Markdown"), true);
});

Deno.test("pickSpecBackend picks 1 for cloud (listed first)", () => {
  const { io } = fakeIO(["1"]);
  assertEquals(pickSpecBackend(io), "cloud");
});

Deno.test("pickSpecBackend picks 2 for local", () => {
  const { io } = fakeIO(["2"]);
  assertEquals(pickSpecBackend(io), "local");
});

Deno.test("pickSpecBackend re-prompts on invalid input", () => {
  const { io, errLog } = fakeIO(["999", "bad", "2"]);
  assertEquals(pickSpecBackend(io), "local");
  assertEquals(errLog.length, 2);
});

Deno.test("pickSpecBackendInteractive returns 'cloud' on Enter (default)", async () => {
  const io = scriptedIO([new Uint8Array([0x0d])]);
  assertEquals(await pickSpecBackendInteractive(io), "cloud");
});

Deno.test("pickSpecBackendInteractive returns 'local' after arrow-down + space", async () => {
  const io = scriptedIO([
    new Uint8Array([0x1b, 0x5b, 0x42]),
    new Uint8Array([0x20]),
  ]);
  assertEquals(await pickSpecBackendInteractive(io), "local");
});

Deno.test("pickSpecBackendInteractive returns null on Ctrl-C cancel", async () => {
  const io = scriptedIO([new Uint8Array([0x03])]);
  assertEquals(await pickSpecBackendInteractive(io), null);
});
