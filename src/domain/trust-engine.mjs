import { cosineSimilarity, embedLocally } from "./embedding.mjs";

const TRUSTED_SOURCE_KINDS = new Set(["verified-system", "human-approved", "signed-service"]);
const HIGH_RISK_PATTERNS = [
  /unlimited/i,
  /bypass/i,
  /without\s+approval/i,
  /approval_required\s*[=:]\s*false/i,
  /refund_limit_usd\s*[=:]\s*(?:[1-9]\d{3,}|unlimited)/i,
  /wire\s+(?:funds|money)/i,
  /ignore\s+(?:policy|previous|security)/i
];

function parseAssertions(claim) {
  const assertions = new Map();
  for (const segment of String(claim).split(/[;,\n]/)) {
    const match = segment.trim().match(/^([a-zA-Z0-9_.-]+)\s*(?:=|:)\s*(.+)$/);
    if (match) {
      assertions.set(match[1].toLowerCase(), match[2].trim().toLowerCase());
    }
  }
  return assertions;
}

function findAssertionConflicts(candidateClaim, trustedMemory) {
  const candidate = parseAssertions(candidateClaim);
  const current = parseAssertions(trustedMemory.claim);
  const conflicts = [];
  for (const [key, value] of candidate) {
    if (current.has(key) && current.get(key) !== value) {
      conflicts.push({
        key,
        candidateValue: value,
        trustedValue: current.get(key),
        trustedMemoryId: trustedMemory.id
      });
    }
  }
  return conflicts;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export class TrustEngine {
  constructor({ now = () => new Date(), adjudicator = null } = {}) {
    this.now = now;
    this.adjudicator = adjudicator;
  }

  async evaluate(candidate, trustedMemories = []) {
    const reasons = [];
    const embedding = candidate.embedding ?? embedLocally(`${candidate.subject} ${candidate.claim}`);
    const source = candidate.source ?? {};
    const trustedSource = TRUSTED_SOURCE_KINDS.has(source.kind);
    const authenticated = source.authenticated === true;
    const signed = source.signatureValid === true;
    const highRisk = HIGH_RISK_PATTERNS.some((pattern) => pattern.test(candidate.claim));
    const expired = Boolean(candidate.expiresAt && new Date(candidate.expiresAt) <= this.now());
    const conflicts = [];

    for (const memory of trustedMemories) {
      const assertionConflicts = findAssertionConflicts(candidate.claim, memory);
      if (assertionConflicts.length === 0) continue;
      const similarity = cosineSimilarity(embedding, memory.embedding ?? embedLocally(`${memory.subject} ${memory.claim}`));
      conflicts.push({
        memoryId: memory.id,
        similarity: Number(similarity.toFixed(4)),
        assertions: assertionConflicts
      });
    }

    let riskScore = 0;
    if (!trustedSource) {
      riskScore += 20;
      reasons.push("Source type is outside the trusted provenance policy.");
    }
    if (!authenticated) {
      riskScore += 20;
      reasons.push("Source identity is not authenticated.");
    }
    if (!signed) {
      riskScore += 15;
      reasons.push("Memory has no valid provenance signature.");
    }
    if (highRisk) {
      riskScore += 20;
      reasons.push("Claim can change a high-impact authorization or financial action.");
    }
    if (expired) {
      riskScore += 30;
      reasons.push("Memory is already expired.");
    }
    if (conflicts.length > 0) {
      riskScore += 40;
      reasons.push(`Claim contradicts ${conflicts.length} trusted memory record(s).`);
    }

    let modelAssessment = null;
    if (this.adjudicator && (conflicts.length > 0 || highRisk)) {
      modelAssessment = await this.adjudicator.evaluate({ candidate, conflicts, trustedMemories });
      if (modelAssessment?.riskAdjustment) {
        riskScore += clamp(Number(modelAssessment.riskAdjustment), -10, 10);
      }
      if (modelAssessment?.summary) reasons.push(`Bedrock: ${modelAssessment.summary}`);
    }

    riskScore = clamp(riskScore, 0, 100);
    const forcedQuarantine = expired || (highRisk && (!authenticated || !signed)) || conflicts.length > 0;
    const decision = forcedQuarantine || riskScore >= 60
      ? "quarantined"
      : riskScore >= 30
        ? "review"
        : "trusted";

    if (decision === "trusted") reasons.push("Provenance and policy checks passed.");

    return {
      decision,
      riskScore,
      trustScore: 100 - riskScore,
      reasons,
      conflicts,
      highRisk,
      expired,
      embedding,
      modelAssessment
    };
  }
}

export { findAssertionConflicts, parseAssertions };
