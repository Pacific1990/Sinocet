import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPoolFromEnv } from '../src/db.mjs';

const pool = createPoolFromEnv();
const sql = await readFile(fileURLToPath(new URL('../sql/001_core.sql', import.meta.url)), 'utf8');
const statements = sql.split(/\r?\n/).filter(line => !line.trim().startsWith('--'))
  .join('\n').split(';').map(statement => statement.trim()).filter(Boolean);
try {
  for (const statement of statements) await pool.query(statement);
  console.log('SMTR SQL 001: schema checked');
} finally {
  await pool.end();
}
