import pg from "pg";
import { env } from "../config/env";

const globalForPool = globalThis as unknown as { pgPool?: pg.Pool };

export function getPool(): pg.Pool {
  if (!globalForPool.pgPool) {
    globalForPool.pgPool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }
  return globalForPool.pgPool;
}
