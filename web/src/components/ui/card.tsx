import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type DivProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn('space-y-1.5 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: DivProps) {
  return (
    <div
      className={cn('text-lg leading-snug font-semibold', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn('p-5', className)} {...props} />;
}
