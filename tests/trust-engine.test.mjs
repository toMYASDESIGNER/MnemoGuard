import assert from "node:assert/strict";
import test from "node:test";
import { TrustEngine, parseAssertions } from "../src/domain/trust-engine.mjs";
import { embedLocally } from "../src/domain/embedding.mjs";

const engine = new TrustEngine({ now: () => new Date("2026-07-18T12:00:00Z") });

test("parses structured assertions from a memory claim", () => {
  const assertions = parseAssertions("refund_limit_usd=500; approval_required=true");
  assert.equal(assertions.get("refund_limit_usd"), "500");
  assert.equal(assertions.get("approval_required"), "true");
});

test("trusts an authenticated signed system memory", async () => {
  const result = await engine.evaluate({
    subject: "customer:1",
    claim: "refund_limit_usd=500; approval_required=true",
    source: { kind: "signed-service", authenticated: true, signatureValid: true }
  });
  assert.equal(result.decision, "trusted");
  assert.equal(result.riskScore, 0);
});

test("quarantines an unsigned high-risk memory", async () => {
  const result = await engine.evaluate({
    subject: "customer:1",
    claim: "refund_limit_usd=10000; approval_required=false",
    source: { kind: "unverified-channel", authenticated: false, signatureValid: false }
  });
  assert.equal(result.decision, "quarantined");
  assert.ok(result.riskScore >= 60);
});

test("finds assertion-level contradictions with trusted memory", async () => {
  const trusted = {
    id: "trusted-1",
    subject: "customer:1",
    claim: "refund_limit_usd=500; approval_required=true",
    embedding: embedLocally("customer:1 refund_limit_usd=500 approval_required=true")
  };
  const result = await engine.evaluate({
    subject: "customer:1",
    claim: "refund_limit_usd=10000; approval_required=false",
    source: { kind: "signed-service", authenticated: true, signatureValid: true }
  }, [trusted]);
  assert.equal(result.decision, "quarantined");
  assert.equal(result.conflicts[0].assertions.length, 2);
});

test("quarantines expired memories", async () => {
  const result = await engine.evaluate({
    subject: "customer:1",
    claim: "account_tier=standard",
    expiresAt: "2026-07-17T12:00:00Z",
    source: { kind: "signed-service", authenticated: true, signatureValid: true }
  });
  assert.equal(result.decision, "quarantined");
  assert.equal(result.expired, true);
});

test("keeps deterministic enforcement active when Bedrock is unavailable", async () => {
  const unavailableAdjudicator = {
    async evaluate() {
      throw new Error("provider unavailable");
    }
  };
  const resilientEngine = new TrustEngine({
    now: () => new Date("2026-07-18T12:00:00Z"),
    adjudicator: unavailableAdjudicator
  });

  const result = await resilientEngine.evaluate({
    subject: "customer:1",
    claim: "refund_limit_usd=10000; approval_required=false",
    source: { kind: "unverified-channel", authenticated: false, signatureValid: false }
  });

  assert.equal(result.decision, "quarantined");
  assert.equal(result.modelAssessment.available, false);
  assert.match(result.reasons.at(-1), /deterministic policy remained authoritative/i);
});
