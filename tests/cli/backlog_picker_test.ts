import { assertEquals } from "@std/assert";
import {
  DEFAULT_BACKLOG_BACKEND,
  pickBacklogBackend,
  pickBacklogBackendInteractive,
} from "../../src/cli/backlog_picker.ts";
import type { SelectIO } from "../../src/cli/select.ts";

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

Deno.test("pickBacklogBackend defaults to local on empty input", () => {
  const { io, log } = fakeIO([""]);
  assertEquals(pickBacklogBackend(io), "local");
  assertEquals(DEFAULT_BACKLOG_BACKEND, "local");
  // Lists both backends
  const all = log.join("\n");
  assertEquals(all.includes("Local Markdown"), true);
  assertEquals(all.includes("GitHub"), true);
});

Deno.test("pickBacklogBackend picks 1 for local", () => {
  const { io } = fakeIO(["1"]);
  assertEquals(pickBacklogBackend(io), "local");
});

Deno.test("pickBacklogBackend picks 2 for github", () => {
  const { io } = fakeIO(["2"]);
  assertEquals(pickBacklogBackend(io), "github");
});

Deno.test("pickBacklogBackend picks 3 for gitlab", () => {
  const { io } = fakeIO(["3"]);
  assertEquals(pickBacklogBackend(io), "gitlab");
});

Deno.test("pickBacklogBackend re-prompts on invalid input", () => {
  const { io, errLog } = fakeIO(["999", "bad", "1"]);
  assertEquals(pickBacklogBackend(io), "local");
  assertEquals(errLog.length, 2);
});

Deno.test("pickBacklogBackendInteractive returns 'local' on Enter (default)", async () => {
  const io = scriptedIO([new Uint8Array([0x0d])]);
  assertEquals(await pickBacklogBackendInteractive(io), "local");
});

Deno.test("pickBacklogBackendInteractive returns 'github' after one arrow-down + space", async () => {
  const io = scriptedIO([
    new Uint8Array([0x1b, 0x5b, 0x42]),
    new Uint8Array([0x20]),
  ]);
  assertEquals(await pickBacklogBackendInteractive(io), "github");
});

Deno.test("pickBacklogBackendInteractive returns null on Ctrl-C cancel", async () => {
  const io = scriptedIO([new Uint8Array([0x03])]);
  assertEquals(await pickBacklogBackendInteractive(io), null);
});
