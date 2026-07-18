import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { vectorLiteral } from "../domain/embedding.mjs";

function normalizeRow(row) {
  return {
    id: row.id,
    subject: row.subject,
    claim: row.claim,
    source: row.source,
    state: row.trust_state,
    riskScore: Number(row.risk_score),
    trustScore: 100 - Number(row.risk_score),
    reasons: row.reasons,
    conflicts: row.conflicts,
    highRisk: row.high_risk,
    embedding: typeof row.embedding === "string"
      ? JSON.parse(row.embedding.replace(/\s/g, ""))
      : row.embedding,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by
  };
}

export class CockroachMemoryStore {
  constructor({ connectionString = process.env.DATABASE_URL } = {}) {
    if (!connectionString) throw new Error("DATABASE_URL is required for CockroachDB mode.");
    this.pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 8 });
  }

  async close() {
    await this.pool.end();
  }

  async reset() {
    if (process.env.ALLOW_DEMO_RESET !== "true") {
      throw new Error("Cloud reset is disabled. Set ALLOW_DEMO_RESET=true only in an isolated demo environment.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("TRUNCATE memory_events, memory_records");
      await client.query("UPDATE memory_event_heads SET head_hash = 'GENESIS', version = 0 WHERE stream = 'global'");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async addMemory(record) {
    const result = await this.pool.query(
      `INSERT INTO memory_records
        (id, subject, claim, source, trust_state, risk_score, reasons, conflicts, high_risk, embedding, expires_at)
       VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4::JSONB, $5, $6, $7::JSONB, $8::JSONB, $9, $10::VECTOR, $11)
       RETURNING *`,
      [
        record.id ?? null,
        record.subject,
        record.claim,
        JSON.stringify(record.source ?? {}),
        record.state,
        record.riskScore,
        JSON.stringify(record.reasons ?? []),
        JSON.stringify(record.conflicts ?? []),
        record.highRisk ?? false,
        vectorLiteral(record.embedding),
        record.expiresAt ?? null
      ]
    );
    return normalizeRow(result.rows[0]);
  }

  async updateState(id, state, metadata = {}) {
    const result = await this.pool.query(
      `UPDATE memory_records
       SET trust_state = $2, reviewed_at = now(), reviewed_by = $3
       WHERE id = $1
       RETURNING *`,
      [id, state, metadata.reviewedBy ?? "human-reviewer"]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  async trustedForSubject(subject) {
    const result = await this.pool.query(
      `SELECT * FROM trusted_agent_memory WHERE subject = $1 ORDER BY created_at DESC`,
      [subject]
    );
    return result.rows.map(normalizeRow);
  }

  async getMemory(id) {
    const result = await this.pool.query("SELECT * FROM memory_records WHERE id = $1", [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  async listMemories() {
    const result = await this.pool.query("SELECT * FROM memory_records ORDER BY created_at DESC LIMIT 100");
    return result.rows.map(normalizeRow);
  }

  async appendEvent(type, payload) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const headResult = await client.query(
          "SELECT head_hash, version FROM memory_event_heads WHERE stream = 'global'"
        );
        const head = headResult.rows[0];
        const event = {
          id: randomUUID(),
          type,
          payload,
          createdAt: new Date().toISOString(),
          previousHash: head.head_hash
        };
        event.hash = createHash("sha256")
          .update(event.previousHash)
          .update(JSON.stringify(event))
          .digest("hex");

        await client.query(
          `INSERT INTO memory_events
            (id, event_type, payload, previous_hash, hash, created_at)
           VALUES ($1, $2, $3::JSONB, $4, $5, $6)`,
          [event.id, event.type, JSON.stringify(event.payload), event.previousHash, event.hash, event.createdAt]
        );
        const updated = await client.query(
          `UPDATE memory_event_heads
           SET head_hash = $1, version = version + 1
           WHERE stream = 'global' AND version = $2`,
          [event.hash, head.version]
        );
        if (updated.rowCount !== 1) {
          const conflict = new Error("Concurrent audit append detected");
          conflict.code = "40001";
          throw conflict;
        }
        await client.query("COMMIT");
        return event;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error.code !== "40001" || attempt === 4) throw error;
      } finally {
        client.release();
      }
    }
    throw new Error("Could not append audit event after retries.");
  }

  async listEvents() {
    const result = await this.pool.query("SELECT * FROM memory_events ORDER BY created_at DESC LIMIT 100");
    return result.rows;
  }
}
