import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BedrockAdjudicator } from "./bedrock-adjudicator.mjs";
import { TrustEngine } from "../domain/trust-engine.mjs";
import { DEMO_SUBJECT, MnemoGuardService } from "../service.mjs";
import { CockroachMemoryStore } from "../storage/cockroach-store.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_ROOT = join(ROOT, "web");
const ASSETS = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
  ["/logo.svg", "logo.svg"]
]);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};
const PUBLIC_SOURCE_ID = "support-chat-import";

let servicePromise;

async function defaultServiceProvider() {
  if (!servicePromise) {
    servicePromise = (async () => {
      const adjudicator = process.env.BEDROCK_MODEL_ID
        ? new BedrockAdjudicator()
        : null;
      const service = new MnemoGuardService({
        store: new CockroachMemoryStore(),
        engine: new TrustEngine({ adjudicator })
      });
      await service.seedTrustedPolicy();
      return service;
    })();
  }
  try {
    return await servicePromise;
  } catch (error) {
    servicePromise = null;
    throw error;
  }
}

function headers(contentType, cacheControl = "no-store") {
  return {
    "content-type": contentType,
    "cache-control": cacheControl,
    "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; script-src 'self'; style-src 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
}

function response(statusCode, body, contentType, cacheControl) {
  return {
    statusCode,
    headers: headers(contentType, cacheControl),
    body,
    isBase64Encoded: false
  };
}

function json(statusCode, body) {
  return response(statusCode, JSON.stringify(body), "application/json; charset=utf-8");
}

function publicMemory(memory) {
  return {
    id: memory.id,
    subject: memory.subject,
    claim: memory.claim,
    source: {
      id: memory.source?.id ?? "unknown",
      kind: memory.source?.kind ?? "unknown"
    },
    state: memory.state,
    riskScore: memory.riskScore,
    reasons: memory.reasons,
    createdAt: memory.createdAt
  };
}

function publicState(state) {
  return {
    product: state.product,
    mode: state.mode,
    counts: state.counts,
    memories: state.memories.slice(0, 20).map(publicMemory),
    auditEventCount: state.events.length
  };
}

function attackResult(memory) {
  const blocked = memory.state === "quarantined";
  return {
    baseline: {
      decision: "executed",
      action: "Approved a $10,000 refund",
      explanation: "The baseline agent trusts the most recent retrieved memory."
    },
    guarded: {
      decision: blocked ? "blocked" : "executed",
      action: blocked ? "Refund blocked; human review required" : "Refund approved",
      memoryId: memory.id,
      riskScore: memory.riskScore,
      reasons: memory.reasons
    },
    poisonedMemory: publicMemory(memory),
    replayedEvidence: true
  };
}

async function runIdempotentAttack(service) {
  await service.seedTrustedPolicy();
  const state = await service.state();
  const existing = state.memories.find((memory) => (
    memory.subject === DEMO_SUBJECT
    && memory.source?.id === PUBLIC_SOURCE_ID
    && memory.state === "quarantined"
  ));
  if (existing) return attackResult(existing);
  return { ...await service.runAttackDemo(), replayedEvidence: false };
}

function requestPath(event) {
  return event.rawPath ?? event.requestContext?.http?.path ?? "/";
}

function requestMethod(event) {
  return event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
}

export function createPublicHandler({
  serviceProvider = defaultServiceProvider,
  assetLoader = (filename) => readFile(join(WEB_ROOT, filename), "utf8")
} = {}) {
  return async function publicHandler(event = {}) {
    const path = requestPath(event);
    const method = requestMethod(event).toUpperCase();
    try {
      if ((method === "GET" || method === "HEAD") && ASSETS.has(path)) {
        const filename = ASSETS.get(path);
        let body = await assetLoader(filename);
        if (filename === "index.html") body = body.replace("Reset evidence", "Reset view");
        return response(
          200,
          method === "HEAD" ? "" : body,
          CONTENT_TYPES[extname(filename)],
          filename === "index.html" ? "no-store" : "public, max-age=3600"
        );
      }

      if (method === "GET" && path === "/api/health") {
        return json(200, { ok: true, service: "mnemoguard-public-demo" });
      }

      const service = await serviceProvider();
      if (method === "GET" && path === "/api/state") {
        return json(200, publicState(await service.state()));
      }
      if (method === "POST" && path === "/api/demo/attack") {
        return json(200, await runIdempotentAttack(service));
      }
      if (method === "POST" && path === "/api/demo/reset") {
        return json(200, publicState(await service.state()));
      }
      return json(404, { error: "Not found" });
    } catch (error) {
      console.error("Public demo request failed", { path, method, name: error.name });
      return json(500, { error: "The public demo could not complete this request." });
    }
  };
}

export const handler = createPublicHandler();

