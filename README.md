# MnemoGuard

**The zero-trust firewall for AI agent memory.**

MnemoGuard prevents autonomous agents from acting on poisoned, contradictory, unsigned, or expired memories. It turns memory from an untrusted retrieval cache into a governed production system with provenance, quarantine, human review, and an append-only audit trail.

Built as a new project for the **CockroachDB × AWS Hackathon — Build with Agentic Memory**.

## The two-outcome demo

The demo injects the same poisoned customer memory into two agents:

```text
refund_limit_usd=10000; account_tier=vip; approval_required=false
```

- A baseline agent trusts the newest retrieved memory and executes a $10,000 refund.
- MnemoGuard detects an unsigned source and contradictions with the trusted CRM record, quarantines the memory, and blocks the action.

Run it without credentials:

```bash
npm install
npm run check
npm start
```

Open `http://127.0.0.1:4180`, then select **Run poisoning attack**.

## Architecture

```mermaid
flowchart LR
  S[Memory sources] --> L[AWS Lambda intake]
  L --> B[Amazon Bedrock risk adjudicator]
  L --> G[MnemoGuard policy engine]
  B --> G
  G -->|trusted| T[(CockroachDB trusted memory)]
  G -->|unsafe| Q[(CockroachDB quarantine)]
  T --> V[Distributed vector index]
  T --> M[Managed MCP Server]
  M --> A[AI agent]
  Q --> D[Security dashboard]
  T --> E[Append-only audit events]
  Q --> E
```

## Meaningful platform integration

### CockroachDB

- **Distributed Vector Indexing** finds related records and assertion-level contradictions while relational policy fields remain transactionally consistent with their embeddings.
- **Cloud Managed MCP Server** is the read-only boundary used by agents. It exposes `trusted_agent_memory`; quarantined records never enter an agent's context.
- CockroachDB stores trusted, review, and quarantined states plus the append-only decision history as the durable system of record.

### AWS

- **AWS Lambda** runs the memory-ingestion and policy pipeline independently of any agent process.
- **Amazon Bedrock** provides a constrained second opinion for ambiguous, high-impact or contradictory memories. Deterministic checks remain authoritative and the local demo works without model access.

## Repository map

```text
db/       CockroachDB schema, vector index, trusted-memory view
mcp/      Managed MCP boundary and example configuration
scripts/  local attack demo and migration runner
src/      policy engine, storage adapters, AWS integration, HTTP API
tests/    unit, service, and HTTP tests
web/      judge-facing live dashboard
```

## Cloud setup

1. Create a CockroachDB Cloud cluster on AWS.
2. Enable vector indexes and run `npm run db:migrate` with `DATABASE_URL` set.
3. Generate the Managed MCP endpoint in CockroachDB Cloud and give its read-only identity access to `trusted_agent_memory`.
4. Configure AWS credentials, `AWS_REGION`, and `BEDROCK_MODEL_ID`.
5. Package `src/aws/lambda.mjs` as the Lambda handler or deploy the Node server to an AWS container service.

No secrets belong in Git. Local mode is the default whenever cloud environment variables are absent.

## Security model

MnemoGuard never treats an LLM verdict as sufficient authorization. Deterministic provenance, signature, expiration, conflict, and high-impact rules make the final state decision. Bedrock can adjust a risk score by at most ten points and cannot override forced quarantine.

## License

MIT
