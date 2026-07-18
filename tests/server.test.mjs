import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "../src/server.mjs";
import { MnemoGuardService } from "../src/service.mjs";
import { InMemoryMemoryStore } from "../src/storage/in-memory-store.mjs";

test("HTTP API exposes state and runs the attack simulation", async (context) => {
  const service = new MnemoGuardService({ store: new InMemoryMemoryStore() });
  const { server, url } = await startServer({ port: 0, service });
  context.after(() => server.close());

  const health = await fetch(`${url}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const attackResponse = await fetch(`${url}/api/demo/attack`, { method: "POST" });
  assert.equal(attackResponse.status, 200);
  const attack = await attackResponse.json();
  assert.equal(attack.guarded.decision, "blocked");

  const state = await fetch(`${url}/api/state`).then((response) => response.json());
  assert.equal(state.counts.quarantined, 1);
});
