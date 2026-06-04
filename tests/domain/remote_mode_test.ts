import { assertEquals } from "@std/assert";
import {
  DEFAULT_AWAIT_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  parseEnvFlag,
  resolveRemoteMode,
} from "../../src/domain/cloud/remote_mode.ts";

Deno.test("parseEnvFlag: truthy / falsy / defer-to-config", () => {
  for (const v of ["1", "true", "TRUE", "on", "yes"]) assertEquals(parseEnvFlag(v), true);
  for (const v of ["0", "false", "off", "no", ""]) assertEquals(parseEnvFlag(v), false);
  assertEquals(parseEnvFlag(undefined), null); // unset → defer
  assertEquals(parseEnvFlag("maybe"), null); // unrecognised → defer
});

Deno.test("default is OFF when config and env are absent (no regression)", () => {
  const m = resolveRemoteMode(undefined, undefined);
  assertEquals(m.enabled, false);
  assertEquals(m.awaitTimeoutMs, DEFAULT_AWAIT_TIMEOUT_MS);
  assertEquals(m.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
});

Deno.test("env override beats config: env off overrides config enabled", () => {
  assertEquals(resolveRemoteMode({ enabled: true }, "off").enabled, false);
  assertEquals(resolveRemoteMode({ enabled: false }, "on").enabled, true);
});

Deno.test("unrecognised env defers to config", () => {
  assertEquals(resolveRemoteMode({ enabled: true }, "weird").enabled, true);
  assertEquals(resolveRemoteMode({ enabled: false }, "weird").enabled, false);
});

Deno.test("config knobs are read (seconds → ms) and clamped", () => {
  const m = resolveRemoteMode({ enabled: true, awaitTimeoutS: 60, pollIntervalS: 10 }, undefined);
  assertEquals(m.awaitTimeoutMs, 60_000);
  assertEquals(m.pollIntervalMs, 10_000);

  // out-of-range values are clamped, not trusted
  const tight = resolveRemoteMode({ enabled: true, pollIntervalS: 0 }, undefined);
  assertEquals(tight.pollIntervalMs >= 1_000, true);
  const huge = resolveRemoteMode({ enabled: true, awaitTimeoutS: 10 ** 9 }, undefined);
  assertEquals(huge.awaitTimeoutMs <= 24 * 60 * 60 * 1000, true);
});
