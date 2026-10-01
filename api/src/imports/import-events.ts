import {
  OnQueueEvent,
  QueueEventsHost,
  QueueEventsListener,
} from '@nestjs/bullmq';
import { Observable, Subject } from 'rxjs';
import { IMPORTS_QUEUE, importIdOf, ImportProgress } from '../queues/queues';

export type ImportEvent =
  | ({ type: 'progress' } & ImportProgress)
  /** Status changed (started, retried, completed, failed): refetch it. */
  | { type: 'changed'; importId: string };

/**
 * Bridges BullMQ's queue events (a Redis stream) to an in-process observable.
 * Because the events travel through Redis, this works whether the job runs in
 * this process or in a separate worker.
 */
@QueueEventsListener(IMPORTS_QUEUE)
export class ImportEvents extends QueueEventsHost {
  private readonly subject = new Subject<ImportEvent>();

  get stream(): Observable<ImportEvent> {
    return this.subject.asObservable();
  }

  @OnQueueEvent('progress')
  onProgress({ data }: { data: unknown }): void {
    this.subject.next({ type: 'progress', ...(data as ImportProgress) });
  }

  @OnQueueEvent('active')
  @OnQueueEvent('completed')
  @OnQueueEvent('failed')
  onChange({ jobId }: { jobId: string }): void {
    this.subject.next({ type: 'changed', importId: importIdOf(jobId) });
  }
}
