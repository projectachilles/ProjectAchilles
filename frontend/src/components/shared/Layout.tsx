import type { ReactNode } from 'react';
import { SidebarLayout } from '@/components/layout';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return <SidebarLayout>{children}</SidebarLayout>;
}
