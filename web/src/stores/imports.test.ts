import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob } from '@/lib/api';
import { mergeProgress, useImportsStore } from './imports';

function makeImport(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'a',
    filename: 'grades.csv',
    status: 'queued',
    totalRows: 1000,
    processedRows: 0,
    succeededRows: 0,
    failedRows: 0,
    runs: 1,
    error: null,
    notifyEmail: null,
    createdAt: '2026-01-01T10:00:00Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

const progress = {
  importId: 'a',
  totalRows: 1000,
  processedRows: 500,
  succeededRows: 480,
  failedRows: 20,
};

describe('mergeProgress', () => {
  it('updates the counters of the matching import only', () => {
    const [a, b] = mergeProgress(
      [makeImport(), makeImport({ id: 'b' })],
      progress,
    );

    expect(a).toMatchObject({
      status: 'processing',
      processedRows: 500,
      succeededRows: 480,
      failedRows: 20,
    });
    expect(b.processedRows).toBe(0);
  });

  it('ignores a late event for an import that already finished', () => {
    const [item] = mergeProgress(
      [makeImport({ status: 'completed', processedRows: 1000 })],
      progress,
    );

    expect(item).toMatchObject({ status: 'completed', processedRows: 1000 });
  });
});

describe('useImportsStore', () => {
  beforeEach(() => {
    useImportsStore.setState({
      imports: [],
      page: 1,
      status: '',
      selectedId: null,
      error: null,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const respondWith = (body: unknown, status = 200) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
    );

  it('loads a page of imports', async () => {
    respondWith({
      data: [makeImport()],
      meta: { page: 1, limit: 8, total: 1, totalPages: 1 },
    });

    await useImportsStore.getState().load();

    expect(useImportsStore.getState()).toMatchObject({
      total: 1,
      loading: false,
      imports: [{ id: 'a' }],
    });
  });

  it('keeps the API error message when loading fails', async () => {
    respondWith({ message: 'status must be a valid enum value' }, 400);

    await useImportsStore.getState().load();

    expect(useImportsStore.getState().error).toBe(
      'status must be a valid enum value',
    );
  });

  it('does not refetch an import that is not on the current page', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await useImportsStore.getState().refresh('not-listed');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
