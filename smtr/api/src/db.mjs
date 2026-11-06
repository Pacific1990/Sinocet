import mysql from 'mysql2/promise';

export function createPoolFromEnv() {
  const required = ['DB_HOST','DB_NAME','DB_USER','DB_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error('SMTR MySQL configuration missing: ' + missing.join(', '));
  return mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, waitForConnections: true,
    connectionLimit: 10, queueLimit: 100,
    timezone: 'Z', charset: 'utf8mb4', multipleStatements: false,
    decimalNumbers: false,
  });
}

export async function transaction(pool, operation) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await operation(conn);
    await conn.commit();
    return result;
  } catch(error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
