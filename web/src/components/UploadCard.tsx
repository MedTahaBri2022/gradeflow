import { UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { useImportsStore } from '@/stores/imports';

const MAX_BYTES = 5 * 1024 * 1024;

/** Same rules as the API, checked first in the browser for instant feedback. */
function validate(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    return 'Only .csv files are accepted';
  }
  if (file.size > MAX_BYTES) return 'The file is larger than 5 MB';
  if (file.size === 0) return 'The file is empty';
  return null;
}

export function UploadCard() {
  const upload = useImportsStore((state) => state.upload);
  const input = useRef<HTMLInputElement>(null);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(file: File | undefined) {
    if (!file) return;
    const problem = validate(file);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await upload(file, notifyEmail.trim());
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
      if (input.current) input.current.value = '';
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void submit(event.dataTransfer.files[0]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New import</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center transition-colors',
            dragging && 'border-primary bg-primary/5',
          )}
        >
          <UploadCloud className="size-8 text-muted-foreground" />
          <p className="text-sm">
            Drop a CSV here, or{' '}
            <label className="cursor-pointer font-medium text-primary hover:underline">
              browse
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={pending}
                onChange={(event) => void submit(event.target.files?.[0])}
              />
            </label>
          </p>
          <p className="text-xs text-muted-foreground">
            Columns: student_email, student_name, course_code, score, graded_on
            · up to 5 MB
          </p>
          {pending && <p className="text-xs font-medium">Uploading...</p>}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Field label="Notify by email when finished (optional)">
          {(id) => (
            <Input
              id={id}
              type="email"
              placeholder="registrar@school.test"
              value={notifyEmail}
              onChange={(event) => setNotifyEmail(event.target.value)}
            />
          )}
        </Field>

        <a href="/sample-grades.csv" download className="block">
          <Button variant="outline" size="sm" className="w-full" tabIndex={-1}>
            Download a sample file
          </Button>
        </a>
      </CardContent>
    </Card>
  );
}
