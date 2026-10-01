import { Workflow } from 'lucide-react';
import { useEffect } from 'react';
import { ImportDetail } from '@/components/ImportDetail';
import { ImportsTable } from '@/components/ImportsTable';
import { QueueHealth } from '@/components/QueueHealth';
import { UploadCard } from '@/components/UploadCard';
import { useImportsStore } from '@/stores/imports';

export function App() {
  // One event stream for the whole page, opened once.
  useEffect(() => {
    const { load, connect } = useImportsStore.getState();
    void load();
    return connect();
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="flex items-center gap-2">
        <Workflow className="size-6 text-primary" />
        <div>
          <h1 className="text-xl leading-tight font-bold">GradeFlow</h1>
          <p className="text-sm text-muted-foreground">
            Bulk grade imports: the upload returns at once, a background worker
            validates and stores the rows, progress is pushed live.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-6">
          <UploadCard />
          <QueueHealth />
        </aside>
        <div className="min-w-0 space-y-6">
          <ImportsTable />
          <ImportDetail />
        </div>
      </div>
    </div>
  );
}
