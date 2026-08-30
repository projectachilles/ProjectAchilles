import type { HTMLAttributes } from 'react';

export function Skeleton({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="skeleton"
      aria-hidden="true"
      className={`bg-raised animate-pulse rounded-md ${className}`}
      {...rest}
    />
  );
}

export default Skeleton;
