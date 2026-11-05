import { cn, statusNames } from '@/lib/utils';

export function Status({ value }: { value: string }) {
  return (
    <span className={cn('status', `status-${value.toLowerCase()}`)}>
      <span aria-hidden="true" />
      {statusNames[value] ?? value}
    </span>
  );
}
