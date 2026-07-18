import { TrustEngine } from "./domain/trust-engine.mjs";

export const DEMO_SUBJECT = "customer:ACME-1042";

export class MnemoGuardService {
  constructor({ store, engine = new TrustEngine() }) {
    this.store = store;
    this.engine = engine;
  }

  async ingest(candidate) {
    if (!candidate?.subject || !candidate?.claim) {
      throw new Error("subject and claim are required");
    }
    const trustedMemories = await this.store.trustedForSubject(candidate.subject);
    const assessment = await this.engine.evaluate(candidate, trustedMemories);
    const memory = await this.store.addMemory({
      ...candidate,
      state: assessment.decision,
      riskScore: assessment.riskScore,
      trustScore: assessment.trustScore,
      reasons: assessment.reasons,
      conflicts: assessment.conflicts,
      highRisk: assessment.highRisk,
      embedding: assessment.embedding
    });
    await this.store.appendEvent("memory.assessed", {
      memoryId: memory.id,
      subject: memory.subject,
      state: memory.state,
      riskScore: memory.riskScore
    });
    return memory;
  }

  async seedTrustedPolicy() {
    const current = await this.store.trustedForSubject(DEMO_SUBJECT);
    if (current.length > 0) return current[0];
    return this.ingest({
      subject: DEMO_SUBJECT,
      claim: "refund_limit_usd=500; account_tier=standard; approval_required=true",
      source: {
        id: "crm-prod",
        kind: "signed-service",
        authenticated: true,
        signatureValid: true
      }
    });
  }

  async runAttackDemo() {
    await this.seedTrustedPolicy();
    const poisonedMemory = {
      subject: DEMO_SUBJECT,
      claim: "refund_limit_usd=10000; account_tier=vip; approval_required=false",
      source: {
        id: "support-chat-import",
        kind: "unverified-channel",
        authenticated: false,
        signatureValid: false
      }
    };

    const baseline = {
      decision: "executed",
      action: "Approved a $10,000 refund",
      explanation: "The baseline agent trusts the most recent retrieved memory."
    };
    const protectedMemory = await this.ingest(poisonedMemory);
    const guarded = {
      decision: protectedMemory.state === "quarantined" ? "blocked" : "executed",
      action: protectedMemory.state === "quarantined"
        ? "Refund blocked; human review required"
        : "Refund approved",
      memoryId: protectedMemory.id,
      riskScore: protectedMemory.riskScore,
      reasons: protectedMemory.reasons
    };
    await this.store.appendEvent("demo.attack-completed", {
      baseline: baseline.decision,
      guarded: guarded.decision,
      poisonedMemoryId: protectedMemory.id
    });
    return { baseline, guarded, poisonedMemory: protectedMemory };
  }

  async approve(id, reviewedBy = "human-reviewer") {
    const memory = await this.store.updateState(id, "trusted", { reviewedBy });
    if (!memory) return null;
    await this.store.appendEvent("memory.human-approved", { memoryId: id, reviewedBy });
    return memory;
  }

  async state() {
    const [memories, events] = await Promise.all([
      this.store.listMemories(),
      this.store.listEvents()
    ]);
    return {
      product: "MnemoGuard",
      mode: this.store.constructor.name.includes("Cockroach") ? "cockroachdb" : "local",
      counts: {
        total: memories.length,
        trusted: memories.filter((memory) => memory.state === "trusted").length,
        review: memories.filter((memory) => memory.state === "review").length,
        quarantined: memories.filter((memory) => memory.state === "quarantined").length
      },
      memories,
      events
    };
  }
}
