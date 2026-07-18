import assert from "node:assert/strict";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL before running npm run db:verify");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
});

try {
  const identity = await pool.query("SELECT current_database() AS database, current_user AS user");
  const relations = await pool.query(
    `SELECT table_name, table_type
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('memory_records', 'memory_events', 'memory_event_heads')
     ORDER BY table_name`
  );
  const views = await pool.query(
    `SELECT table_name
     FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'trusted_agent_memory'`
  );
  const indexes = await pool.query("SHOW INDEXES FROM memory_records");
  const indexNames = [...new Set(indexes.rows.map((row) => row.index_name))];

  assert.equal(relations.rows.length, 3, "Expected all three MnemoGuard tables");
  assert.equal(views.rows.length, 1, "Expected trusted_agent_memory view");
  assert.ok(indexNames.includes("memory_embedding_idx"), "Expected CockroachDB vector index");
  assert.ok(indexNames.includes("memory_subject_state_idx"), "Expected subject/state index");

  console.log("MnemoGuard CockroachDB verification passed.");
  console.log(`Database: ${identity.rows[0].database}`);
  console.log(`SQL user: ${identity.rows[0].user}`);
  console.log(`Tables: ${relations.rows.map((row) => row.table_name).join(", ")}`);
  console.log(`View: ${views.rows[0].table_name}`);
  console.log(`Indexes: ${indexNames.join(", ")}`);
} finally {
  await pool.end();
}
