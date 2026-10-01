export type ImportStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ImportJob {
  id: string;
  filename: string;
  status: ImportStatus;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  runs: number;
  error: string | null;
  notifyEmail: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImportError {
  id: string;
  rowNumber: number;
  message: string;
  raw: Record<string, string>;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

/** Payload of the `progress` server-sent event. */
export interface ImportProgress {
  importId: string;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
}

export const API_URL: string = import.meta.env?.VITE_API_URL ?? '/api';

async function parse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { message?: string | string[] } | null)
      ?.message;
    throw new Error(
      Array.isArray(message)
        ? message.join(', ')
        : (message ?? response.statusText),
    );
  }
  return payload as T;
}

export const api = {
  get: async <T>(path: string, signal?: AbortSignal): Promise<T> =>
    parse<T>(await fetch(`${API_URL}${path}`, { signal })),

  post: async <T>(path: string, body?: FormData): Promise<T> =>
    parse<T>(await fetch(`${API_URL}${path}`, { method: 'POST', body })),
};
