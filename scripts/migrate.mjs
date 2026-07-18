import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL before running npm run db:migrate");
}

const sql = await readFile(fileURLToPath(new URL("../db/001_init.sql", import.meta.url)), "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await pool.query(sql);
  console.log("MnemoGuard schema migrated successfully.");
} finally {
  await pool.end();
}
