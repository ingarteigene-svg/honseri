import type { Metadata } from 'next';
import LoggList from '@/components/LoggList';

export const metadata: Metadata = {
  title: 'Logg – Gjødseljournal',
};

export default function LoggPage() {
  return <LoggList />;
}
