import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ImportStatus {
  Queued = 'queued',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}

@Entity('imports')
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  filename: string;

  /** SHA-256 of the file: the same file is never imported twice. */
  @Column({ type: 'char', length: 64 })
  checksum: string;

  @Column({ type: 'varchar', length: 20, default: ImportStatus.Queued })
  status: ImportStatus;

  @Column({ name: 'total_rows', type: 'int' })
  totalRows: number;

  @Column({ name: 'processed_rows', type: 'int', default: 0 })
  processedRows: number;

  @Column({ name: 'succeeded_rows', type: 'int', default: 0 })
  succeededRows: number;

  @Column({ name: 'failed_rows', type: 'int', default: 0 })
  failedRows: number;

  /** Number of times the import was enqueued (1 + manual retries). */
  @Column({ type: 'int', default: 1 })
  runs: number;

  /** Last failure, kept while the job is being retried. */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'notify_email', type: 'varchar', nullable: true })
  notifyEmail: string | null;

  // The raw file. Never loaded by default; purged by the maintenance job.
  @Column({ type: 'text', nullable: true, select: false })
  content: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}

@Entity('import_errors')
export class ImportError {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'import_id', type: 'uuid' })
  importId: string;

  @ManyToOne(() => ImportJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'import_id' })
  import: ImportJob;

  /** Line in the uploaded file (the header is line 1). */
  @Column({ name: 'row_number', type: 'int' })
  rowNumber: number;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb' })
  raw: Record<string, string>;
}
