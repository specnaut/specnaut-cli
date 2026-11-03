import { GateClient } from "../../src/domain/cloud/gate_client.ts";
import { GateSession, type TokenProvider } from "../../src/domain/cloud/gate_session.ts";
import type { RemoteMode } from "../../src/domain/cloud/remote_mode.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";

/** The in-memory gate backend and session both gate session test files drive. */

export const API = "https://api.example.com";

export const REMOTE: RemoteMode = { enabled: true, awaitTimeoutMs: 60_000, pollIntervalMs: 5_000 };

export function gate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gate_abc",
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
    state: "open",
    answer: null,
    createdBy: "agent:specnaut-cli",
    resolvedBy: null,
    createdAt: "2026-06-04T10:00:00Z",
    resolvedAt: null,
    ...over,
  };
}

/** A mutable in-memory backend the fetch closure reads, so a test can flip state. */
export class Backend {
  state = "open";
  answer: Record<string, unknown> | null = null;
  getCalls = 0;
  failGetTimes = 0; // emit a transient 500 for the first N get probes
  tokensSeen: string[] = [];

  fetch: FetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
    this.tokensSeen.push(auth.replace("Bearer ", ""));
    const reply = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );

    if (method === "POST" && url.endsWith("/api/v1/gates")) {
      return reply(201, { gate: gate() });
    }
    if (method === "GET" && url.includes("/gates?")) {
      this.getCalls++;
      if (this.failGetTimes > 0) {
        this.failGetTimes--;
        return reply(500, { error: "transient" });
      }
      return reply(200, {
        gates: [gate({ state: this.state, answer: this.answer })],
        cursor: "",
        hasMore: false,
      });
    }
    if (method === "POST" && url.includes("/apply")) {
      this.state = "applied";
      return reply(200, { gate: gate({ state: "applied", answer: this.answer }) });
    }
    if (method === "POST" && url.includes("/cancel")) {
      this.state = "cancelled";
      return reply(200, { gate: gate({ state: "cancelled" }) });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as FetchFn;
}

/** A fake clock: sleep advances time and resolves instantly. */
export function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

export function session(
  backend: Backend,
  token: TokenProvider,
  remote = REMOTE,
  { now, sleep } = fakeClock(),
): GateSession {
  // Late-bind through `backend.fetch` so a test may reassign it after construction.
  const lateFetch =
    ((i: string | URL | Request, init?: RequestInit) => backend.fetch(i, init)) as FetchFn;
  return new GateSession({
    projectKey: "CLOUD",
    client: new GateClient(API, lateFetch),
    remote,
    token,
    now,
    sleep,
  });
}

export function gateObj(_be: Backend) {
  return {
    id: "gate_abc",
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: {},
    state: "answered",
    answer: { text: "x" },
    createdBy: "a",
    resolvedBy: "u",
    createdAt: "2026-06-04T10:00:00Z",
    resolvedAt: "2026-06-04T10:01:00Z",
  };
}
