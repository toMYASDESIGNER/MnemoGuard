import { BedrockAdjudicator } from "./bedrock-adjudicator.mjs";
import { TrustEngine } from "../domain/trust-engine.mjs";
import { MnemoGuardService } from "../service.mjs";
import { CockroachMemoryStore } from "../storage/cockroach-store.mjs";

let service;

function getService() {
  if (!service) {
    const adjudicator = process.env.BEDROCK_MODEL_ID
      ? new BedrockAdjudicator()
      : null;
    service = new MnemoGuardService({
      store: new CockroachMemoryStore(),
      engine: new TrustEngine({ adjudicator })
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
