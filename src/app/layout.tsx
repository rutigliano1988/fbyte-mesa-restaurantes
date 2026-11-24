import type { Metadata } from 'next';
import { Archivo } from 'next/font/google';
import { BRAND } from '@/config/brand';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: BRAND.productName, template: `%s · ${BRAND.productName}` },
  description: BRAND.tagline,
  icons: { icon: '/brand/favicon.svg', apple: '/brand/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={archivo.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
