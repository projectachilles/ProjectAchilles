import type { ReactNode } from 'react';
import { PageHeader as SharedPageHeader } from '@/components/layout/PageHeader';

// Page container for consistent padding
interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className = '' }: PageContainerProps) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}

// Page header with title and optional actions
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <SharedPageHeader title={title} description={description}>
      {actions}
    </SharedPageHeader>
  );
}
