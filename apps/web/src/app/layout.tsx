import type { Metadata, Viewport } from 'next';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import './globals.css';
import './easy.css';
import './messenger.css';

export const metadata: Metadata = {
  title: { default: 'نیتیکت | پشتیبانی دانشگاه', template: '%s | نیتیکت' },
  description: 'سامانه ارتباط و پشتیبانی دانشگاه صنعتی نوشیروانی بابل',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <a className="skip-link" href="#main-content">
          رفتن به محتوای اصلی
        </a>
        {children}
      </body>
    </html>
  );
}
