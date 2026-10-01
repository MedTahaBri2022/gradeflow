# GradeFlow

Bulk grade imports done asynchronously: the HTTP request only accepts the
file, **BullMQ workers** validate and store the rows in the background, and the
browser follows the progress live over **server-sent events**.

**NestJS 11 · TypeScript · BullMQ · Redis 7 · PostgreSQL 17 · React 19 · Zustand · Tailwind CSS**

[![CI](https://github.com/MedTahaBri2022/gradeflow/actions/workflows/ci.yml/badge.svg)](https://github.com/MedTahaBri2022/gradeflow/actions/workflows/ci.yml)

Measured locally: uploading a 12,000-row file returns `202 Accepted` in about
120 ms; the rows are then processed in batches of 500 while the UI shows a
progress bar, the rejected rows and a downloadable error report.

## How a file flows through the system

```
Browser ──POST /imports──▶ API ──┬─ validate header, checksum (no duplicates)
   ▲                             ├─ INSERT imports (status = queued)
   │                             └─ queue.add('import')  ──▶ Redis
   │ 202 + import id
   │
   │                    ┌──────────── worker (same process or separate) ─────┐
   │                    │ ImportProcessor ▶ ImportRunner                     │
   │                    │   stream CSV ▶ validate row ▶ batch of 500         │
   │                    │   1 transaction per batch:                         │
   │                    │     upsert students, upsert grades,                │
   │                    │     insert row errors, update counters             │
   │                    │   job.updateProgress(...)                          │
   │                    │ on success/final failure ▶ notifications queue     │
   │                    └────────────────────────────────────────────────────┘
   │                                         │ queue events (Redis stream)
   └──── SSE /imports/events ◀── API ◀───────┘
```

## What the project demonstrates

**Queues and background jobs**

| Concern | How it is handled |
| --- | --- |
| Retries | 3 attempts with exponential backoff for transient failures (database, network). |
| Poison messages | A malformed file raises a `PermanentImportError`, translated to BullMQ's `UnrecoverableError`: it fails at once instead of burning retries. |
| Idempotency | Grades are upserted on their natural key `(student, course, date)` and each run first resets the import's counters and errors, so a retried or re-run job cannot duplicate data. |
| Duplicate submissions | SHA-256 of the file + a partial unique index (`WHERE status <> 'failed'`): the same file cannot be imported twice, even by two concurrent uploads. |
| Consistency | Each batch is one transaction containing data, row errors *and* progress counters: what the UI shows is what the tables contain. |
| Separate concerns, separate queues | Notifications have their own queue and retry policy; a mail outage never fails an import. A unique constraint makes the notification at-most-once. |
| Scheduled work | A job scheduler (cron) purges stored files after 7 days; registered with an upsert so several instances do not create several schedules. |
| Scaling out | `RUN_WORKER=false` runs the API alone; `npm run start:worker` runs consumers alone. Progress still reaches browsers because it travels through Redis, not process memory. |
| Graceful shutdown | Shutdown hooks let a worker finish its current job before exiting. |
| Observability | `GET /api/queues` exposes job counts per queue and state; the dashboard polls it. |
| Redis as a queue | `appendonly yes` and `noeviction`: the opposite of a cache configuration. |

**Throughput.** A batch of 500 rows costs two SQL statements
(`INSERT ... SELECT FROM unnest(...) ON CONFLICT`), not 500 round trips.

**SOLID.** The pipeline (`ImportRunner`) knows nothing about BullMQ; the
processor is a thin adapter that only decides what is retried. Row validation
(`row-parser.ts`) is a pure function. Mail goes through an abstract `Mailer`
port (a logging implementation is provided – no real mail is sent).

**REST API.** DTO validation, paginated and filterable lists, one error
envelope from a global exception filter, `202 Accepted` for asynchronous
operations, `409` for duplicates, `503` if the queue is unreachable, OpenAPI
docs at `/api/docs`. The CSV error report escapes spreadsheet formulas.

**Front end.** One Zustand store owns the list, pagination, filter, selection
and the SSE connection. Progress events update the store without any HTTP
call; status changes refetch only the affected import; after a reconnection the
list is resynchronized.

## Run it locally

Requirements: Node.js 22+, Docker.

```bash
docker compose up -d            # PostgreSQL :54323, Redis :63793

cd api
npm install
npm run start:dev               # http://localhost:3002/api/docs

cd ../web
npm install
npm run dev                     # http://localhost:5175
```

Use *Download a sample file* in the UI, or generate a bigger one:

```bash
cd api
npm run --silent sample -- 20000 > grades.csv
```

To watch the progress bar on small files, start the API with
`IMPORT_BATCH_DELAY_MS=400` (artificial pause per batch, demo only).

## Tests

```bash
cd api
npm test            # row validation rules, retry/failure decisions, error filter
npm run test:e2e    # real PostgreSQL + Redis + BullMQ workers
npm run lint

cd ../web
npm test            # store: progress merging, loading, error handling
npm run build
```

The e2e suite uploads real files over HTTP and waits for the workers: partial
success with rejected rows, error report, duplicate upload (`409`), upsert on
re-import, permanent failure without retries, manual retry, follow-up
notification job.

## API

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/imports` | multipart `file` (+ optional `notifyEmail`) → `202` |
| GET | `/api/imports?status=&page=&limit=` | paginated |
| GET | `/api/imports/events` | server-sent events: `progress`, `changed` |
| GET | `/api/imports/:id` | status and counters |
| GET | `/api/imports/:id/errors?page=&limit=` | rejected rows |
| GET | `/api/imports/:id/errors.csv` | error report |
| POST | `/api/imports/:id/retry` | failed imports only → `202` |
| GET | `/api/queues` | job counts |

CSV columns: `student_email, student_name, course_code, score, graded_on`
(`YYYY-MM-DD`). Known course codes are seeded by the migration (`CS101`,
`CS205`, `CS310`, `CS420`, `MA101`, `MA220`, `PH101`, `BU150`).

## Limits and next steps

- Files are capped at 5 MB and stored in PostgreSQL so that API and workers
  need no shared disk; larger files would go to object storage.
- The import row and its job are written to two systems (PostgreSQL, Redis).
  If enqueueing fails the row is removed and the client gets `503`; a
  transactional outbox would close the remaining crash window.
- A retried import restarts from the first row. It is safe (idempotent) but
  not minimal; a per-batch checkpoint would avoid the rework.
- No authentication: the project focuses on the asynchronous pipeline.

## License

MIT
