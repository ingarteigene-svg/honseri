import type { Metadata } from 'next';
import SettingsView from '@/components/SettingsView';

export const metadata: Metadata = {
  title: 'Innstillinger – Gjødseljournal',
};

export default function InnstillingerPage() {
  return <SettingsView />;
}
