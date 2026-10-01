import { create } from 'zustand';
import {
  api,
  API_URL,
  type ImportJob,
  type ImportProgress,
  type ImportStatus,
  type Paginated,
} from '@/lib/api';

export const PAGE_SIZE = 8;

type LiveState = 'connecting' | 'open';

interface ImportsState {
  imports: ImportJob[];
  total: number;
  totalPages: number;
  page: number;
  status: ImportStatus | '';
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  live: LiveState;

  load: () => Promise<void>;
  setPage: (page: number) => void;
  setStatus: (status: ImportStatus | '') => void;
  select: (id: string | null) => void;
  upload: (file: File, notifyEmail: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  /** Applies a progress event without any network call. */
  applyProgress: (progress: ImportProgress) => void;
  /** Refetches one import after its status changed. */
  refresh: (id: string) => Promise<void>;
  /** Opens the event stream; returns the function that closes it. */
  connect: () => () => void;
}

/** Pure merge of a progress event into the list (exported for tests). */
export function mergeProgress(
  imports: ImportJob[],
  progress: ImportProgress,
): ImportJob[] {
  return imports.map((item) => {
    if (item.id !== progress.importId) return item;
    // The final state comes from the API; a progress event that is applied
    // after it must not reopen a finished import.
    if (item.status === 'completed' || item.status === 'failed') return item;
    return {
      ...item,
      status: 'processing',
      processedRows: progress.processedRows,
      succeededRows: progress.succeededRows,
      failedRows: progress.failedRows,
    };
  });
}

export const useImportsStore = create<ImportsState>((set, get) => ({
  imports: [],
  total: 0,
  totalPages: 1,
  page: 1,
  status: '',
  selectedId: null,
  loading: false,
  error: null,
  live: 'connecting',

  load: async () => {
    const { page, status } = get();
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(status && { status }),
      });
      const result = await api.get<Paginated<ImportJob>>(`/imports?${params}`);
      // Ignore the response if the user changed page or filter meanwhile.
      if (get().page !== page || get().status !== status) return;
      set({
        imports: result.data,
        total: result.meta.total,
        totalPages: Math.max(1, result.meta.totalPages),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
    }
  },

  setPage: (page) => {
    set({ page });
    void get().load();
  },

  setStatus: (status) => {
    set({ status, page: 1 });
    void get().load();
  },

  select: (selectedId) => set({ selectedId }),

  upload: async (file, notifyEmail) => {
    const body = new FormData();
    body.append('file', file);
    if (notifyEmail) body.append('notifyEmail', notifyEmail);
    const created = await api.post<ImportJob>('/imports', body);
    // Show the new import first, wherever the user was.
    set({ page: 1, status: '', selectedId: created.id });
    await get().load();
  },

  retry: async (id) => {
    const retried = await api.post<ImportJob>(`/imports/${id}/retry`);
    set((state) => ({
      imports: state.imports.map((item) => (item.id === id ? retried : item)),
    }));
  },

  applyProgress: (progress) =>
    set((state) => ({ imports: mergeProgress(state.imports, progress) })),

  refresh: async (id) => {
    if (!get().imports.some((item) => item.id === id)) return;
    try {
      const fresh = await api.get<ImportJob>(`/imports/${id}`);
      set((state) => ({
        imports: state.imports.map((item) => (item.id === id ? fresh : item)),
      }));
    } catch {
      // A missed refresh is repaired by the next event or reload.
    }
  },

  connect: () => {
    const source = new EventSource(`${API_URL}/imports/events`);
    let opened = false;

    source.onopen = () => {
      // After a reconnection, events may have been missed: resynchronize.
      if (opened) void get().load();
      opened = true;
      set({ live: 'open' });
    };
    // EventSource reconnects on its own; only reflect the state.
    source.onerror = () => set({ live: 'connecting' });

    source.addEventListener('progress', (event) =>
      get().applyProgress(
        JSON.parse((event as MessageEvent<string>).data) as ImportProgress,
      ),
    );
    source.addEventListener('changed', (event) => {
      const { importId } = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as { importId: string };
      void get().refresh(importId);
    });

    return () => source.close();
  },
}));
