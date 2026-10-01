import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Progress } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import type { ImportJob, ImportStatus } from '@/lib/api';
import { cn, formatNumber, formatTime } from '@/lib/utils';
import { useImportsStore } from '@/stores/imports';

const STATUS_STYLE: Record<ImportStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  processing: 'bg-primary/10 text-primary',
  completed: 'bg-success/15 text-success',
  failed: 'bg-destructive/10 text-destructive',
};

export function StatusBadge({ item }: { item: ImportJob }) {
  const label =
    item.status === 'completed' && item.failedRows > 0
      ? 'completed with errors'
      : item.status === 'queued' && item.error
        ? 'retrying'
        : item.status;
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        label === 'completed with errors'
          ? 'bg-amber-500/15 text-amber-700'
          : STATUS_STYLE[item.status],
      )}
    >
      {label}
    </span>
  );
}

export const percent = (item: ImportJob): number =>
  item.status === 'completed'
    ? 100
    : item.totalRows
      ? Math.min(100, Math.round((item.processedRows / item.totalRows) * 100))
      : 0;

export function ImportsTable() {
  const imports = useImportsStore((state) => state.imports);
  const total = useImportsStore((state) => state.total);
  const page = useImportsStore((state) => state.page);
  const totalPages = useImportsStore((state) => state.totalPages);
  const status = useImportsStore((state) => state.status);
  const selectedId = useImportsStore((state) => state.selectedId);
  const error = useImportsStore((state) => state.error);
  const live = useImportsStore((state) => state.live);
  const { setPage, setStatus, select, retry } = useImportsStore.getState();

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-3 space-y-0">
        <CardTitle className="flex flex-1 items-center gap-3">
          Imports
          <span
            className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground"
            title="Server-sent events connection"
          >
            <span
              className={cn(
                'size-2 rounded-full',
                live === 'open' ? 'bg-success' : 'animate-pulse bg-amber-500',
              )}
            />
            {live === 'open' ? 'live' : 'reconnecting'}
          </span>
        </CardTitle>
        <Select
          aria-label="Filter by status"
          className="w-auto"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as ImportStatus | '')
          }
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </Select>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {imports.length === 0 ? (
          <EmptyState title="No import yet">
            Upload a CSV file to see it processed in the background.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {imports.map((item) => (
              <li key={item.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={item.id === selectedId}
                  onClick={() => select(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') select(item.id);
                  }}
                  className={cn(
                    'cursor-pointer space-y-2 rounded-lg px-3 py-3 hover:bg-muted',
                    item.id === selectedId && 'bg-primary/5',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {item.filename}
                    </span>
                    <StatusBadge item={item} />
                    {item.status === 'failed' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          void retry(item.id).catch(() => undefined);
                        }}
                      >
                        <RotateCcw className="size-3.5" /> Retry
                      </Button>
                    )}
                  </div>
                  <Progress value={percent(item)} />
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                    <span>
                      {formatNumber(item.processedRows)} /{' '}
                      {formatNumber(item.totalRows)} rows
                    </span>
                    <span className="text-success">
                      {formatNumber(item.succeededRows)} imported
                    </span>
                    {item.failedRows > 0 && (
                      <span className="text-destructive">
                        {formatNumber(item.failedRows)} rejected
                      </span>
                    )}
                    <span className="ml-auto">{formatTime(item.createdAt)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {total} imports
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
