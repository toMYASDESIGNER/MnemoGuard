import { MnemoGuardService } from "../src/service.mjs";
import { InMemoryMemoryStore } from "../src/storage/in-memory-store.mjs";

const service = new MnemoGuardService({ store: new InMemoryMemoryStore() });
const result = await service.runAttackDemo();

console.log("MnemoGuard attack simulation");
console.log(`Baseline: ${result.baseline.decision.toUpperCase()} — ${result.baseline.action}`);
console.log(`Protected: ${result.guarded.decision.toUpperCase()} — ${result.guarded.action}`);
console.log(`Risk score: ${result.guarded.riskScore}/100`);

if (result.baseline.decision !== "executed" || result.guarded.decision !== "blocked") {
  process.exitCode = 1;
}
