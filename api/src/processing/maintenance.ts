import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { MAINTENANCE_QUEUE } from '../queues/queues';

const RETENTION_DAYS = 7;

/** Recurring job: drop the raw file of imports that finished a week ago. */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly db: DataSource) {
    super();
  }

  async process(): Promise<{ purged: number }> {
    const [, purged] = await this.db.query<[unknown, number]>(
      `UPDATE imports
          SET content = NULL
        WHERE content IS NOT NULL
          AND finished_at < now() - make_interval(days => $1)`,
      [RETENTION_DAYS],
    );
    if (purged) this.logger.log(`Purged the file of ${purged} imports`);
    return { purged };
  }
}

@Injectable()
export class MaintenanceScheduler implements OnModuleInit {
  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  // Upsert: every instance can call this at boot, only one schedule exists.
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'purge-import-files',
      { pattern: '0 3 * * *' },
      { name: 'purge-import-files', opts: { removeOnComplete: 10 } },
    );
  }
}
