import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1759449600000 implements MigrationInterface {
  name = 'Init1759449600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE students (
        id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar NOT NULL UNIQUE,
        name  varchar NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE courses (
        id    serial PRIMARY KEY,
        code  varchar(16) NOT NULL UNIQUE,
        title varchar NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO courses (code, title) VALUES
        ('CS101', 'Introduction to Programming'),
        ('CS205', 'Data Structures'),
        ('CS310', 'Databases'),
        ('CS420', 'Distributed Systems'),
        ('MA101', 'Calculus I'),
        ('MA220', 'Linear Algebra'),
        ('PH101', 'Mechanics'),
        ('BU150', 'Accounting')
    `);

    await queryRunner.query(`
      CREATE TABLE imports (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filename       varchar NOT NULL,
        checksum       char(64) NOT NULL,
        status         varchar(20) NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
        total_rows     int NOT NULL,
        processed_rows int NOT NULL DEFAULT 0,
        succeeded_rows int NOT NULL DEFAULT 0,
        failed_rows    int NOT NULL DEFAULT 0,
        runs           int NOT NULL DEFAULT 1,
        error          text,
        notify_email   varchar,
        content        text,
        created_at     timestamptz NOT NULL DEFAULT now(),
        started_at     timestamptz,
        finished_at    timestamptz
      )
    `);
    // Idempotent uploads, enforced by the database: one live import per file.
    // A failed import does not block uploading the same file again.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_imports_checksum_live
        ON imports (checksum) WHERE status <> 'failed'
    `);
    await queryRunner.query(
      `CREATE INDEX idx_imports_created ON imports (created_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE import_errors (
        id         bigserial PRIMARY KEY,
        import_id  uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        row_number int NOT NULL,
        message    text NOT NULL,
        raw        jsonb NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_import_errors_import
        ON import_errors (import_id, row_number)
    `);

    await queryRunner.query(`
      CREATE TABLE grades (
        id         bigserial PRIMARY KEY,
        student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        course_id  int NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        score      numeric(5, 2) NOT NULL CHECK (score BETWEEN 0 AND 100),
        graded_on  date NOT NULL,
        import_id  uuid REFERENCES imports(id) ON DELETE SET NULL,
        -- The natural key that makes re-processing a file an upsert.
        CONSTRAINT uq_grades_natural UNIQUE (student_id, course_id, graded_on)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE notifications (
        id        bigserial PRIMARY KEY,
        import_id uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        recipient varchar NOT NULL,
        subject   varchar NOT NULL,
        body      text NOT NULL,
        sent_at   timestamptz NOT NULL DEFAULT now(),
        -- A retried notification job cannot send the same mail twice.
        CONSTRAINT uq_notifications_import UNIQUE (import_id)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notifications`);
    await queryRunner.query(`DROP TABLE grades`);
    await queryRunner.query(`DROP TABLE import_errors`);
    await queryRunner.query(`DROP TABLE imports`);
    await queryRunner.query(`DROP TABLE courses`);
    await queryRunner.query(`DROP TABLE students`);
  }
}
