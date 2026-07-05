import type { Metadata } from 'next';
import SkifteOversikt from '@/components/SkifteOversikt';

export const metadata: Metadata = {
  title: 'Per skifte – Gjødseljournal',
};

export default function SkifterPage() {
  return <SkifteOversikt />;
}
