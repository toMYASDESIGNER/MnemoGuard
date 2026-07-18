import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BedrockAdjudicator } from "./aws/bedrock-adjudicator.mjs";
import { TrustEngine } from "./domain/trust-engine.mjs";
import { MnemoGuardService } from "./service.mjs";
import { CockroachMemoryStore } from "./storage/cockroach-store.mjs";
import { InMemoryMemoryStore } from "./storage/in-memory-store.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_ROOT = join(ROOT, "web");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function staticFile(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!new Set(["index.html", "app.js", "styles.css", "logo.svg"]).has(requested)) return false;
  const file = join(WEB_ROOT, requested);
  const body = await readFile(file);
  response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(body);
  return true;
}

export function createHandler(service) {
  return async function handler(request, response) {
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, { ok: true, service: "mnemoguard" });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        return json(response, 200, await service.state());
      }
      if (request.method === "POST" && url.pathname === "/api/demo/reset") {
        await service.store.reset();
        await service.seedTrustedPolicy();
        return json(response, 200, await service.state());
      }
      if (request.method === "POST" && url.pathname === "/api/demo/attack") {
        return json(response, 200, await service.runAttackDemo());
      }
      if (request.method === "POST" && url.pathname === "/api/memories") {
        return json(response, 201, await service.ingest(await readJson(request)));
      }
      const approveMatch = url.pathname.match(/^\/api\/memories\/([^/]+)\/approve$/);
      if (request.method === "POST" && approveMatch) {
        const memory = await service.approve(approveMatch[1]);
        return memory ? json(response, 200, memory) : json(response, 404, { error: "Memory not found" });
      }
      if (request.method === "GET" && await staticFile(url.pathname, response)) return;
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  };
}

export function createDefaultService() {
  const store = process.env.DATABASE_URL
    ? new CockroachMemoryStore()
    : new InMemoryMemoryStore();
  const adjudicator = process.env.BEDROCK_MODEL_ID
    ? new BedrockAdjudicator()
    : null;
  return new MnemoGuardService({ store, engine: new TrustEngine({ adjudicator }) });
}

export async function startServer({
  host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 4180),
  service = createDefaultService()
} = {}) {
  await service.seedTrustedPolicy();
  const server = http.createServer(createHandler(service));
  await new Promise((resolve) => server.listen(port, host, resolve));
  return { server, service, url: `http://${host}:${server.address().port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url, service } = await startServer();
  console.log(`MnemoGuard dashboard: ${url}`);
  console.log(`Persistence mode: ${(await service.state()).mode}`);
}
