import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const HEADER = 'student_email,student_name,course_code,score,graded_on';

interface ImportBody {
  id: string;
  status: string;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  runs: number;
  error: string | null;
}

/**
 * Real PostgreSQL, real Redis, real BullMQ workers: a file goes through HTTP,
 * the queue and the pipeline exactly as in production.
 */
describe('GradeFlow (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let db: DataSource;

  const upload = (name: string, rows: string[], notifyEmail?: string) => {
    const call = request(http)
      .post('/api/imports')
      .attach('file', Buffer.from([HEADER, ...rows].join('\n')), name);
    return notifyEmail ? call.field('notifyEmail', notifyEmail) : call;
  };

  async function waitUntilDone(id: string): Promise<ImportBody> {
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await request(http).get(`/api/imports/${id}`);
      const body = response.body as ImportBody;
      if (body.status === 'completed' || body.status === 'failed') return body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Import ${id} did not finish in time`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    db = app.get(DataSource);
    await db.query('TRUNCATE imports, students, grades CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects files that cannot be processed, before queueing anything', async () => {
    await request(http).post('/api/imports').expect(400);
    await request(http)
      .post('/api/imports')
      .attach('file', Buffer.from('hello'), 'notes.txt')
      .expect(400);

    const response = await request(http)
      .post('/api/imports')
      .attach('file', Buffer.from('student_email,score\na@b.co,10'), 'x.csv')
      .expect(400);
    expect((response.body as { message: string }).message).toBe(
      'Missing column(s): student_name, course_code, graded_on',
    );
  });

  it('processes a file in the background and reports rejected rows', async () => {
    const rows = [
      'ada@school.test,Ada Lovelace,CS101,91.5,2026-01-10', // line 2
      'ada@school.test,Ada Lovelace,MA101,78,2026-01-11', // line 3
      'linus@school.test,Linus T,CS101,150,2026-01-10', // line 4: score
      'grace@school.test,Grace Hopper,XX999,80,2026-01-10', // line 5: course
      'ada@school.test,Ada Lovelace,CS101,60,2026-01-10', // line 6: duplicate
      'grace@school.test,Grace Hopper,CS310,88,2026-01-12', // line 7
    ];

    const accepted = await upload(
      'january.csv',
      rows,
      'registrar@school.test',
    ).expect(202);
    expect(accepted.body).toMatchObject({ status: 'queued', totalRows: 6 });
    expect(accepted.body).not.toHaveProperty('content');

    const done = await waitUntilDone((accepted.body as ImportBody).id);
    expect(done).toMatchObject({
      status: 'completed',
      processedRows: 6,
      succeededRows: 3,
      failedRows: 3,
    });

    const errors = await request(http)
      .get(`/api/imports/${done.id}/errors`)
      .expect(200);
    expect(
      (
        errors.body as { data: { rowNumber: number; message: string }[] }
      ).data.map((error) => [error.rowNumber, error.message]),
    ).toEqual([
      [4, 'score must be a number between 0 and 100'],
      [5, 'Unknown course code XX999'],
      [6, 'Duplicate of an earlier row in this file'],
    ]);

    const report = await request(http)
      .get(`/api/imports/${done.id}/errors.csv`)
      .expect(200);
    expect(report.headers['content-disposition']).toContain(
      'january-errors.csv',
    );
    expect(report.text.split('\n')[1]).toBe(
      '4,linus@school.test,Linus T,CS101,150,2026-01-10,score must be a number between 0 and 100',
    );

    const [{ grades, students }] = await db.query<
      { grades: number; students: number }[]
    >(
      `SELECT (SELECT COUNT(*)::int FROM grades) AS grades,
              (SELECT COUNT(*)::int FROM students) AS students`,
    );
    expect({ grades, students }).toEqual({ grades: 3, students: 2 });

    // The follow-up job on the notifications queue ran too.
    let notifications: { recipient: string; subject: string }[] = [];
    for (let attempt = 0; attempt < 50 && !notifications.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      notifications = await db.query(
        'SELECT recipient, subject FROM notifications WHERE import_id = $1',
        [done.id],
      );
    }
    expect(notifications).toEqual([
      {
        recipient: 'registrar@school.test',
        subject: 'Import finished: january.csv',
      },
    ]);
  });

  it('refuses the same file twice', async () => {
    const rows = ['alan@school.test,Alan Turing,CS205,95,2026-02-01'];
    const first = await upload('february.csv', rows).expect(202);
    await waitUntilDone((first.body as ImportBody).id);

    const second = await upload('renamed.csv', rows).expect(409);
    expect((second.body as { message: string }).message).toContain(
      (first.body as ImportBody).id,
    );
  });

  it('upserts grades: a corrected file updates, it does not duplicate', async () => {
    const corrected = await upload('january-fixed.csv', [
      'ada@school.test,Ada Lovelace,CS101,93,2026-01-10',
    ]).expect(202);
    await waitUntilDone((corrected.body as ImportBody).id);

    const rows = await db.query<{ score: string }[]>(
      `SELECT g.score FROM grades g
         JOIN students s ON s.id = g.student_id
         JOIN courses c ON c.id = g.course_id
        WHERE s.email = 'ada@school.test' AND c.code = 'CS101'`,
    );
    expect(rows).toEqual([{ score: '93.00' }]);
  });

  it('fails a malformed file without retrying, and allows a manual retry', async () => {
    const accepted = await upload('broken.csv', [
      'ada@school.test,"Ada Lovelace,CS101,90,2026-03-01', // quote never closed
    ]).expect(202);
    const id = (accepted.body as ImportBody).id;

    const failed = await waitUntilDone(id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Malformed CSV');

    // Only failed imports can be retried.
    const list = await request(http)
      .get('/api/imports')
      .query({ status: 'completed', limit: 1 })
      .expect(200);
    const completedId = (list.body as { data: ImportBody[] }).data[0].id;
    await request(http).post(`/api/imports/${completedId}/retry`).expect(409);

    const retried = await request(http)
      .post(`/api/imports/${id}/retry`)
      .expect(202);
    expect(retried.body).toMatchObject({ status: 'queued', runs: 2 });

    // waitUntilDone would return on the stale "failed"; wait for the new run.
    let again = failed;
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const response = await request(http).get(`/api/imports/${id}`);
      again = response.body as ImportBody;
      if (again.status === 'failed') break;
    }
    expect(again).toMatchObject({ status: 'failed', runs: 2 });
  });

  it('paginates and filters the list of imports', async () => {
    const response = await request(http)
      .get('/api/imports')
      .query({ status: 'completed', page: 1, limit: 2 })
      .expect(200);

    expect(response.body).toMatchObject({
      meta: { page: 1, limit: 2, total: 3, totalPages: 2 },
    });
    await request(http)
      .get('/api/imports')
      .query({ status: 'nope' })
      .expect(400);
  });

  it('exposes queue counters', async () => {
    const response = await request(http).get('/api/queues').expect(200);
    expect(
      (response.body as { name: string }[]).map((queue) => queue.name),
    ).toEqual(['imports', 'notifications', 'maintenance']);
  });
});
