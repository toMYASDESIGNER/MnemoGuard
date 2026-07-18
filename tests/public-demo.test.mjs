import assert from "node:assert/strict";
import test from "node:test";
import { createPublicHandler } from "../src/aws/public-demo.mjs";

function event(method, path) {
  return { rawPath: path, requestContext: { http: { method, path } } };
}

function fakeState() {
  return {
    product: "MnemoGuard",
    mode: "cockroachdb",
    counts: { total: 2, trusted: 1, review: 0, quarantined: 1 },
    memories: [{
      id: "poisoned-1",
      subject: "customer:ACME-1042",
      claim: "refund_limit_usd=10000; approval_required=false",
      source: {
        id: "support-chat-import",
        kind: "unverified-channel",
        authenticated: false,
        signatureValid: false
      },
      state: "quarantined",
      riskScore: 100,
      reasons: ["Unsigned high-impact memory"],
      conflicts: [{ internal: "not public" }],
      embedding: [0.1, 0.2]
    }],
    events: [{ hash: "internal-audit-hash" }]
  };
}

test("public demo exposes only sanitized state", async () => {
  const service = { state: async () => fakeState(), seedTrustedPolicy: async () => {} };
  const handler = createPublicHandler({ serviceProvider: async () => service });
  const response = await handler(event("GET", "/api/state"));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.mode, "cockroachdb");
  assert.equal(body.auditEventCount, 1);
  assert.equal(body.memories[0].source.id, "support-chat-import");
  assert.equal("authenticated" in body.memories[0].source, false);
  assert.equal("embedding" in body.memories[0], false);
  assert.equal("events" in body, false);
});

test("public attack replays existing evidence without another database write", async () => {
  let attackRuns = 0;
  const service = {
    state: async () => fakeState(),
    seedTrustedPolicy: async () => {},
    runAttackDemo: async () => {
      attackRuns += 1;
      throw new Error("should not run");
    }
  };
  const handler = createPublicHandler({ serviceProvider: async () => service });
  const response = await handler(event("POST", "/api/demo/attack"));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.guarded.decision, "blocked");
  assert.equal(body.replayedEvidence, true);
  assert.equal(attackRuns, 0);
});

test("public surface rejects arbitrary memory ingestion and never resets storage", async () => {
  let resetRuns = 0;
  const service = {
    state: async () => fakeState(),
    store: { reset: async () => { resetRuns += 1; } }
  };
  const handler = createPublicHandler({
    serviceProvider: async () => service,
    assetLoader: async () => "Reset evidence"
  });

  const ingestion = await handler(event("POST", "/api/memories"));
  const reset = await handler(event("POST", "/api/demo/reset"));
  const page = await handler(event("GET", "/"));

  assert.equal(ingestion.statusCode, 404);
  assert.equal(reset.statusCode, 200);
  assert.equal(resetRuns, 0);
  assert.equal(page.body, "Reset view");
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
});

