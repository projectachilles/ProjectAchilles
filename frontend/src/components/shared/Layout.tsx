import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return <AppShell>{children}</AppShell>;
}
