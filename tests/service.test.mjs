import assert from "node:assert/strict";
import test from "node:test";
import { MnemoGuardService } from "../src/service.mjs";
import { InMemoryMemoryStore } from "../src/storage/in-memory-store.mjs";

test("attack demo shows baseline execution and protected blocking", async () => {
  const service = new MnemoGuardService({ store: new InMemoryMemoryStore() });
  const result = await service.runAttackDemo();
  assert.equal(result.baseline.decision, "executed");
  assert.equal(result.guarded.decision, "blocked");
  assert.equal(result.poisonedMemory.state, "quarantined");
  const state = await service.state();
  assert.equal(state.counts.trusted, 1);
  assert.equal(state.counts.quarantined, 1);
  assert.equal(state.events.length, 3);
});

test("a human can promote a quarantined record after review", async () => {
  const service = new MnemoGuardService({ store: new InMemoryMemoryStore() });
  const result = await service.runAttackDemo();
  const approved = await service.approve(result.poisonedMemory.id, "security@example.test");
  assert.equal(approved.state, "trusted");
  assert.equal(approved.reviewedBy, "security@example.test");
});
