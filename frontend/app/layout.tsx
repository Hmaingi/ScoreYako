import './globals.css';
import type { Metadata } from 'next';
import AppShell from '../components/AppShell';

export const metadata: Metadata = { title: 'Scoreyako | Collections OS', description: 'Financial relationship intelligence and collection action platform' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body><AppShell>{children}</AppShell></body></html>; }