import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsvError, parse } from 'csv-parse';
import { DataSource, EntityManager } from 'typeorm';
import type { Env } from '../config/env';
import { ImportJob, ImportStatus } from '../imports/import.entity';
import type { ImportProgress } from '../queues/queues';
import { GradeRow, parseRow, RawRow } from './row-parser';

/** A failure that retrying cannot fix (missing or malformed file). */
export class PermanentImportError extends Error {}

export const BATCH_SIZE = 500;

interface PendingRow {
  rowNumber: number;
  raw: RawRow;
  value?: GradeRow;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The import pipeline, independent from the queue that triggers it.
 *
 * The file is streamed and written in batches of 500 rows; each batch is one
 * transaction containing the upserts, the row errors and the counters, so the
 * numbers shown to the user always match what is in the tables.
 *
 * Idempotent by construction: grades are upserted on their natural key and
 * every run starts by resetting the import's counters and errors. A retry
 * after a crash therefore simply restarts the file.
 */
@Injectable()
export class ImportRunner {
  private readonly batchDelayMs: number;

  constructor(
    private readonly db: DataSource,
    config: ConfigService<Env, true>,
  ) {
    this.batchDelayMs = config.get('IMPORT_BATCH_DELAY_MS', { infer: true });
  }

  async run(
    importId: string,
    onProgress: (progress: ImportProgress) => Promise<void>,
  ): Promise<ImportProgress> {
    const record = await this.db
      .getRepository(ImportJob)
      .createQueryBuilder('i')
      .addSelect('i.content')
      .where('i.id = :importId', { importId })
      .getOne();
    if (!record) throw new PermanentImportError('Import not found');
    if (record.content === null) {
      throw new PermanentImportError('The uploaded file is no longer stored');
    }

    await this.start(importId);
    const courseIds = await this.loadCourses();

    const progress: ImportProgress = {
      importId,
      totalRows: record.totalRows,
      processedRows: 0,
      succeededRows: 0,
      failedRows: 0,
    };
    const seen = new Set<string>();
    let batch: PendingRow[] = [];
    let rowNumber = 1; // the header

    const flush = async () => {
      if (!batch.length) return;
      const { succeeded, failed } = await this.writeBatch(
        importId,
        batch,
        courseIds,
        seen,
      );
      progress.processedRows += batch.length;
      progress.succeededRows += succeeded;
      progress.failedRows += failed;
      batch = [];
      await onProgress({ ...progress });
      if (this.batchDelayMs) await sleep(this.batchDelayMs);
    };

    const parser = parse(record.content, {
      bom: true,
      columns: (header: string[]) =>
        header.map((column) => column.trim().toLowerCase()),
      skip_empty_lines: true,
      // A row with a missing cell is that row's error, not a fatal one.
      relax_column_count: true,
    });

    try {
      for await (const raw of parser as AsyncIterable<RawRow>) {
        rowNumber++;
        const parsed = parseRow(raw);
        batch.push(
          parsed.ok
            ? { rowNumber, raw, value: parsed.value }
            : { rowNumber, raw, error: parsed.error },
        );
        if (batch.length >= BATCH_SIZE) await flush();
      }
      await flush();
    } catch (error) {
      if (error instanceof CsvError) {
        throw new PermanentImportError(`Malformed CSV: ${error.message}`);
      }
      throw error;
    }

    await this.db.getRepository(ImportJob).update(importId, {
      status: ImportStatus.Completed,
      finishedAt: new Date(),
      error: null,
    });
    return progress;
  }

  /** Called between attempts: the job goes back to the queue. */
  async markRetrying(importId: string, reason: string): Promise<void> {
    await this.db
      .getRepository(ImportJob)
      .update(importId, { status: ImportStatus.Queued, error: reason });
  }

  async markFailed(importId: string, reason: string): Promise<void> {
    await this.db.getRepository(ImportJob).update(importId, {
      status: ImportStatus.Failed,
      error: reason,
      finishedAt: new Date(),
    });
  }

  private async start(importId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query('DELETE FROM import_errors WHERE import_id = $1', [
        importId,
      ]);
      await tx.getRepository(ImportJob).update(importId, {
        status: ImportStatus.Processing,
        processedRows: 0,
        succeededRows: 0,
        failedRows: 0,
        startedAt: new Date(),
        finishedAt: null,
      });
    });
  }

  private async loadCourses(): Promise<Map<string, number>> {
    const rows: Array<{ id: number; code: string }> = await this.db.query(
      'SELECT id, code FROM courses',
    );
    return new Map(rows.map((row) => [row.code, row.id]));
  }

  private async writeBatch(
    importId: string,
    batch: PendingRow[],
    courseIds: Map<string, number>,
    seen: Set<string>,
  ): Promise<{ succeeded: number; failed: number }> {
    // Rules that need more than the row itself.
    for (const row of batch) {
      if (!row.value) continue;
      const key = `${row.value.email}|${row.value.courseCode}|${row.value.gradedOn}`;
      if (!courseIds.has(row.value.courseCode)) {
        row.error = `Unknown course code ${row.value.courseCode}`;
      } else if (seen.has(key)) {
        row.error = 'Duplicate of an earlier row in this file';
      } else {
        seen.add(key);
      }
    }

    const valid = batch.filter((row) => !row.error) as Array<
      PendingRow & { value: GradeRow }
    >;
    const invalid = batch.filter((row) => row.error);

    await this.db.transaction(async (tx) => {
      if (valid.length) await this.upsertGrades(tx, importId, valid, courseIds);
      if (invalid.length) {
        await tx.query(
          `INSERT INTO import_errors (import_id, row_number, message, raw)
           SELECT $1::uuid, t.row_number, t.message, t.raw::jsonb
             FROM unnest($2::int[], $3::text[], $4::text[])
               AS t(row_number, message, raw)`,
          [
            importId,
            invalid.map((row) => row.rowNumber),
            invalid.map((row) => row.error),
            invalid.map((row) => JSON.stringify(row.raw)),
          ],
        );
      }
      await tx.query(
        `UPDATE imports
            SET processed_rows = processed_rows + $2,
                succeeded_rows = succeeded_rows + $3,
                failed_rows = failed_rows + $4
          WHERE id = $1`,
        [importId, batch.length, valid.length, invalid.length],
      );
    });

    return { succeeded: valid.length, failed: invalid.length };
  }

  /** Two statements per batch, whatever its size (no per-row round trip). */
  private async upsertGrades(
    tx: EntityManager,
    importId: string,
    rows: Array<{ value: GradeRow }>,
    courseIds: Map<string, number>,
  ): Promise<void> {
    // A student may appear several times in a batch, but ON CONFLICT cannot
    // touch the same row twice in one statement.
    const students = new Map(
      rows.map(({ value }) => [value.email, value.name]),
    );
    const saved: Array<{ id: string; email: string }> = await tx.query(
      `INSERT INTO students (email, name)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email`,
      [[...students.keys()], [...students.values()]],
    );
    const studentIds = new Map(saved.map((row) => [row.email, row.id]));

    await tx.query(
      `INSERT INTO grades (student_id, course_id, score, graded_on, import_id)
       SELECT t.student_id, t.course_id, t.score, t.graded_on, $5::uuid
         FROM unnest($1::uuid[], $2::int[], $3::numeric[], $4::date[])
           AS t(student_id, course_id, score, graded_on)
       ON CONFLICT ON CONSTRAINT uq_grades_natural
       DO UPDATE SET score = EXCLUDED.score, import_id = EXCLUDED.import_id`,
      [
        rows.map(({ value }) => studentIds.get(value.email)),
        rows.map(({ value }) => courseIds.get(value.courseCode)),
        rows.map(({ value }) => value.score),
        rows.map(({ value }) => value.gradedOn),
        importId,
      ],
    );
  }
}
