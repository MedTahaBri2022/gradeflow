export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  CORS_ORIGIN: string;
  /** Set to false to run the HTTP API without consuming jobs. */
  RUN_WORKER: boolean;
  /** Artificial pause after each batch, only useful to watch progress in a demo. */
  IMPORT_BATCH_DELAY_MS: number;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const nodeEnv = (raw.NODE_ENV as Env['NODE_ENV']) ?? 'development';
  if (nodeEnv === 'production' && !(raw.DATABASE_URL && raw.REDIS_URL)) {
    throw new Error('DATABASE_URL and REDIS_URL must be set in production');
  }

  const port = Number(raw.PORT ?? 3002);
  const delay = Number(raw.IMPORT_BATCH_DELAY_MS ?? 0);
  if (!Number.isInteger(port) || !Number.isInteger(delay) || delay < 0) {
    throw new Error('PORT and IMPORT_BATCH_DELAY_MS must be integers');
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL:
      (raw.DATABASE_URL as string) ??
      'postgres://gradeflow:gradeflow@localhost:54323/gradeflow',
    REDIS_URL: (raw.REDIS_URL as string) ?? 'redis://localhost:63793',
    CORS_ORIGIN: (raw.CORS_ORIGIN as string) ?? 'http://localhost:5175',
    RUN_WORKER: raw.RUN_WORKER !== 'false',
    IMPORT_BATCH_DELAY_MS: delay,
  };
}

/** BullMQ takes ioredis options, not a URL. */
export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number(parsed.pathname.slice(1) || 0),
  };
}
