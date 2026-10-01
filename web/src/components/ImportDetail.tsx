import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buttonVariants, Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { api, API_URL, type ImportError, type Paginated } from '@/lib/api';
import { useImportsStore } from '@/stores/imports';
import { StatusBadge } from './ImportsTable';

const PAGE_SIZE = 6;
// jsonb does not keep key order: show the cells in the file's column order.
const COLUMNS = [
  'student_email',
  'student_name',
  'course_code',
  'score',
  'graded_on',
];

/** Rejected rows of the selected import, with the reason for each. */
export function ImportDetail() {
  const item = useImportsStore((state) =>
    state.imports.find((candidate) => candidate.id === state.selectedId),
  );
  const [page, setPage] = useState(1);
  const [errors, setErrors] = useState<Paginated<ImportError> | null>(null);

  const id = item?.id;
  const failedRows = item?.failedRows ?? 0;
  useEffect(() => setPage(1), [id]);

  // Refetched while the import runs, as new rejected rows are recorded.
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    api
      .get<Paginated<ImportError>>(
        `/imports/${id}/errors?page=${page}&limit=${PAGE_SIZE}`,
        controller.signal,
      )
      .then(setErrors)
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, page, failedRows]);

  if (!item) {
    return (
      <EmptyState title="Select an import">
        Its rejected rows are listed here.
      </EmptyState>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="min-w-0 flex-1 truncate">{item.filename}</span>
          <StatusBadge item={item} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Run {item.runs}
          {item.notifyEmail && ` · notifies ${item.notifyEmail}`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {item.error}
          </p>
        )}

        {errors && errors.data.length > 0 ? (
          <>
            <ul className="divide-y divide-border text-sm">
              {errors.data.map((error) => (
                <li key={error.id} className="py-2">
                  <p>
                    <span className="font-mono text-xs text-muted-foreground">
                      line {error.rowNumber}
                    </span>{' '}
                    {error.message}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {COLUMNS.map((column) => error.raw[column]).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2">
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
                  disabled={page >= errors.meta.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
              <a
                href={`${API_URL}/imports/${item.id}/errors.csv`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Download className="size-3.5" /> Error report
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {item.status === 'completed'
              ? 'Every row was imported.'
              : 'No rejected row so far.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
