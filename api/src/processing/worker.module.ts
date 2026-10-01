import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { ImportProcessor } from './import.processor';
import { ImportRunner } from './import-runner';
import { MaintenanceProcessor, MaintenanceScheduler } from './maintenance';
import { LogMailer, Mailer, NotificationProcessor } from './notifications';

/**
 * Everything that consumes jobs. Loaded inside the API process by default, or
 * alone by src/worker.ts to scale workers independently from HTTP.
 */
@Module({
  imports: [QueuesModule],
  providers: [
    ImportRunner,
    ImportProcessor,
    NotificationProcessor,
    MaintenanceProcessor,
    MaintenanceScheduler,
    { provide: Mailer, useClass: LogMailer },
  ],
})
export class WorkerModule {}
