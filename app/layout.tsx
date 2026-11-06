import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getI18n, getLocale } from '../src/i18n/server';
import { I18nProvider } from './components/i18n';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: 'musicsync',
    description: t('meta.description'),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
