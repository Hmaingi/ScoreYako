import dotenv from 'dotenv';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const rawConnectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/scoreyako';
const sanitizedConnectionString = rawConnectionString.replace(/([?&])sslmode=[^&]+/gi, '$1').replace(/[?&]$/, '');
const shouldUseSsl = sanitizedConnectionString.includes('neon.tech') || sanitizedConnectionString.includes('postgresql://');
const pool = new Pool({
    connectionString: sanitizedConnectionString,
    ssl: shouldUseSsl && !sanitizedConnectionString.includes('localhost') && !sanitizedConnectionString.includes('127.0.0.1')
        ? { rejectUnauthorized: false }
        : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
export async function query(text, params = []) {
    return pool.query(text, params);
}
export async function testConnection() {
    const result = await query('SELECT NOW() AS now');
    return result.rows[0];
}
export default pool;
