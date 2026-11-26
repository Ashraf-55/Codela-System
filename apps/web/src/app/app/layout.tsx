import type { ReactNode } from 'react';
import { AppShell } from '@/components/app/AppShell';
export const metadata = { title: 'Dashboard', robots: { index: false } };
export default function AppLayout({ children }: { children: ReactNode }) { return <AppShell>{children}</AppShell>; }
