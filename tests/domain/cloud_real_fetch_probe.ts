// Run in its own process by cloud_real_fetch_test.ts, which holds no network
// permission: one request per client, on the real `fetch`, each outcome printed.

import { CloudClient } from "../../src/domain/cloud/cloud_client.ts";
import { GateClient } from "../../src/domain/cloud/gate_client.ts";
import { SpecClient } from "../../src/domain/cloud/spec_client.ts";

const api = Deno.args[0];
const describe = (e: unknown) => {
  const { name, status, reason } = e as { name: string; status?: number; reason?: string };
  return { name, status, reason };
};
const outcomes = [];
for (
  const call of [
    () => new CloudClient(api).refresh("r"),
    () => new CloudClient(api).listProjects("t"),
    () => new GateClient(api).cancel("t", "g"),
    () => new SpecClient(api).putSteps("t", "K", 1, []),
  ]
) {
  outcomes.push(await call().then(() => "no error", describe));
}
console.log(JSON.stringify(outcomes));
