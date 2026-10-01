// e2e tests truncate tables and run real jobs: dedicated database and Redis db.
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgres://gradeflow:gradeflow@localhost:54323/gradeflow_test';
process.env.REDIS_URL =
  process.env.E2E_REDIS_URL ?? 'redis://localhost:63793/1';
