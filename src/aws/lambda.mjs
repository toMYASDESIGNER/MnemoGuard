import { BedrockAdjudicator } from "./bedrock-adjudicator.mjs";
import { TrustEngine } from "../domain/trust-engine.mjs";
import { MnemoGuardService } from "../service.mjs";
import { CockroachMemoryStore } from "../storage/cockroach-store.mjs";

let service;

function getService() {
  if (!service) {
    service = new MnemoGuardService({
      store: new CockroachMemoryStore(),
      engine: new TrustEngine({ adjudicator: new BedrockAdjudicator() })
    });
  }
  return service;
}

export async function handler(event) {
  try {
    const payload = typeof event.body === "string" ? JSON.parse(event.body) : event.body ?? event;
    const memory = await getService().ingest(payload);
    return { statusCode: 201, headers: { "content-type": "application/json" }, body: JSON.stringify(memory) };
  } catch (error) {
    return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: error.message }) };
  }
}
