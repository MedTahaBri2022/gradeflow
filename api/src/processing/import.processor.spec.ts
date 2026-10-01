import { Job, Queue, UnrecoverableError } from 'bullmq';
import type { ImportJobData, NotificationJobData } from '../queues/queues';
import { ImportProcessor } from './import.processor';
import { ImportRunner, PermanentImportError } from './import-runner';

function makeJob(attemptsMade: number): Job<ImportJobData> {
  return {
    data: { importId: 'import-1' },
    opts: { attempts: 3 },
    attemptsMade,
    updateProgress: jest.fn(),
  } as unknown as Job<ImportJobData>;
}

describe('ImportProcessor', () => {
  let runner: jest.Mocked<
    Pick<ImportRunner, 'run' | 'markFailed' | 'markRetrying'>
  >;
  let notifications: { add: jest.Mock };
  let processor: ImportProcessor;

  beforeEach(() => {
    runner = { run: jest.fn(), markFailed: jest.fn(), markRetrying: jest.fn() };
    notifications = { add: jest.fn() };
    processor = new ImportProcessor(
      runner as unknown as ImportRunner,
      notifications as unknown as Queue<NotificationJobData>,
    );
    for (const level of ['warn', 'error'] as const) {
      jest
        .spyOn(processor['logger'], level)
        .mockImplementation(() => undefined);
    }
  });

  it('queues a notification once the import succeeded', async () => {
    const progress = {
      importId: 'import-1',
      totalRows: 2,
      processedRows: 2,
      succeededRows: 2,
      failedRows: 0,
    };
    runner.run.mockResolvedValue(progress);

    await expect(processor.process(makeJob(0))).resolves.toEqual(progress);
    expect(notifications.add).toHaveBeenCalledWith(
      'import-finished',
      { importId: 'import-1' },
      expect.objectContaining({ attempts: 5 }),
    );
  });

  it('lets transient errors through so BullMQ retries them', async () => {
    const transient = new Error('connection terminated');
    runner.run.mockRejectedValue(transient);

    await expect(processor.process(makeJob(0))).rejects.toBe(transient);
  });

  it('turns permanent errors into unrecoverable ones (no retry)', async () => {
    runner.run.mockRejectedValue(new PermanentImportError('Malformed CSV'));

    await expect(processor.process(makeJob(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('puts the import back in the queue while attempts remain', async () => {
    await processor.onFailed(makeJob(1), new Error('deadlock detected'));

    expect(runner.markRetrying).toHaveBeenCalledWith(
      'import-1',
      'deadlock detected',
    );
    expect(runner.markFailed).not.toHaveBeenCalled();
    expect(notifications.add).not.toHaveBeenCalled();
  });

  it('marks the import as failed after the last attempt', async () => {
    await processor.onFailed(makeJob(3), new Error('deadlock detected'));

    expect(runner.markFailed).toHaveBeenCalledWith(
      'import-1',
      'deadlock detected',
    );
    expect(notifications.add).toHaveBeenCalledTimes(1);
  });

  it('marks the import as failed immediately on an unrecoverable error', async () => {
    await processor.onFailed(makeJob(1), new UnrecoverableError('Malformed'));

    expect(runner.markFailed).toHaveBeenCalledWith('import-1', 'Malformed');
  });
});
