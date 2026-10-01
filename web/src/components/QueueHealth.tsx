import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type QueueCounts } from '@/lib/api';

const POLL_MS = 3000;
const STATES = ['waiting', 'active', 'delayed', 'completed', 'failed'] as const;

/** Job counts per queue, as an operator would watch them. */
export function QueueHealth() {
  const [queues, setQueues] = useState<QueueCounts[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      api
        .get<QueueCounts[]>('/queues')
        .then((result) => !cancelled && setQueues(result))
        .catch(() => undefined);

    void poll();
    const timer = setInterval(() => {
      // No point polling a tab nobody is looking at.
      if (!document.hidden) void poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Queues</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pb-1 font-medium">
                Queue
              </th>
              {STATES.map((state) => (
                <th
                  key={state}
                  scope="col"
                  className="pb-1 text-right font-medium capitalize"
                >
                  {state}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {queues.map((queue) => (
              <tr key={queue.name} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-medium">
                  {queue.name}
                </th>
                {STATES.map((state) => (
                  <td
                    key={state}
                    className={
                      state === 'failed' && queue.failed > 0
                        ? 'text-right text-destructive'
                        : 'text-right'
                    }
                  >
                    {queue[state]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
