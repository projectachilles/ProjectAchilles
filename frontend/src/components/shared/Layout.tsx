import type { ReactNode } from 'react';
import { AchillesShell } from '@/components/layout/AchillesShell';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return <AchillesShell>{children}</AchillesShell>;
}
