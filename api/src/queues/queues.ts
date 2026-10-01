import type { JobsOptions } from 'bullmq';

export const IMPORTS_QUEUE = 'imports';
export const NOTIFICATIONS_QUEUE = 'notifications';
export const MAINTENANCE_QUEUE = 'maintenance';

export interface ImportJobData {
  importId: string;
}

export interface NotificationJobData {
  importId: string;
}

/** Reported by the worker after each batch and pushed to browsers over SSE. */
export interface ImportProgress {
  importId: string;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
}

/**
 * Imports are retried on transient failures (database or network). The
 * pipeline is idempotent, so a retry restarts the file from the top.
 */
export const IMPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

export const NOTIFICATION_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

// BullMQ job ids cannot contain ':'; each run of an import gets its own id so
// that a manual retry is not swallowed by job de-duplication.
export const importJobId = (importId: string, run: number) =>
  `${importId}_${run}`;
export const importIdOf = (jobId: string) => jobId.split('_')[0];
