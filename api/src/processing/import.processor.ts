import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import {
  IMPORTS_QUEUE,
  ImportJobData,
  ImportProgress,
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_JOB_OPTIONS,
  NotificationJobData,
} from '../queues/queues';
import { ImportRunner, PermanentImportError } from './import-runner';

/**
 * Thin BullMQ adapter around ImportRunner: it only decides what is retried
 * and what happens when a job finally succeeds or fails.
 */
@Processor(IMPORTS_QUEUE, { concurrency: 2 })
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly runner: ImportRunner,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJobData>,
  ) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<ImportProgress> {
    const { importId } = job.data;
    try {
      const result = await this.runner.run(importId, (progress) =>
        job.updateProgress(progress),
      );
      await this.notify(importId);
      return result;
    } catch (error) {
      if (error instanceof PermanentImportError) {
        // Tells BullMQ not to spend the remaining attempts on this job.
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ImportJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const { importId } = job.data;
    const attempts = job.opts.attempts ?? 1;
    const exhausted =
      error instanceof UnrecoverableError || job.attemptsMade >= attempts;

    if (exhausted) {
      this.logger.error(`Import ${importId} failed: ${error.message}`);
      await this.runner.markFailed(importId, error.message);
      await this.notify(importId);
    } else {
      this.logger.warn(
        `Import ${importId} attempt ${job.attemptsMade}/${attempts} failed, retrying: ${error.message}`,
      );
      await this.runner.markRetrying(importId, error.message);
    }
  }

  private async notify(importId: string): Promise<void> {
    await this.notifications.add(
      'import-finished',
      { importId },
      NOTIFICATION_JOB_OPTIONS,
    );
  }
}
