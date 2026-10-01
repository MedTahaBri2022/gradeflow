import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { ImportJob, ImportStatus } from '../imports/import.entity';
import { NOTIFICATIONS_QUEUE, NotificationJobData } from '../queues/queues';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Port for outgoing mail. The processor depends on this abstraction; swapping
 * in an SMTP or API-based implementation does not touch the queue code.
 */
export abstract class Mailer {
  abstract send(mail: Mail): Promise<void>;
}

/** Development implementation: no mail leaves the machine. */
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  send(mail: Mail): Promise<void> {
    this.logger.log(`To ${mail.to}: ${mail.subject}`);
    return Promise.resolve();
  }
}

export function buildMail(record: ImportJob, to: string): Mail {
  if (record.status === ImportStatus.Failed) {
    return {
      to,
      subject: `Import failed: ${record.filename}`,
      text: `The import could not be completed: ${record.error ?? 'unknown error'}.`,
    };
  }
  return {
    to,
    subject: `Import finished: ${record.filename}`,
    text:
      `${record.succeededRows} of ${record.totalRows} rows were imported.` +
      (record.failedRows
        ? ` ${record.failedRows} rows were rejected; download the error report to fix them.`
        : ''),
  };
}

/**
 * Sending mail is slow and fails independently from the import, so it has its
 * own queue and its own retry policy.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationProcessor extends WorkerHost {
  constructor(
    private readonly db: DataSource,
    private readonly mailer: Mailer,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<'sent' | 'skipped'> {
    const record = await this.db
      .getRepository(ImportJob)
      .findOne({ where: { id: job.data.importId } });
    if (!record?.notifyEmail) return 'skipped';

    const mail = buildMail(record, record.notifyEmail);

    // Claim the notification first: the unique constraint guarantees that a
    // retried job (or a second worker) sends at most one mail per import.
    const claimed: unknown[] = await this.db.query(
      `INSERT INTO notifications (import_id, recipient, subject, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT uq_notifications_import DO NOTHING
       RETURNING id`,
      [record.id, mail.to, mail.subject, mail.text],
    );
    if (!claimed.length) return 'skipped';

    try {
      await this.mailer.send(mail);
    } catch (error) {
      // Release the claim so the retry can send it.
      await this.db.query('DELETE FROM notifications WHERE import_id = $1', [
        record.id,
      ]);
      throw error;
    }
    return 'sent';
  }
}
