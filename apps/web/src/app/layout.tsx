import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { isTheme, THEME_KEY, themeBootstrap } from '@/lib/theme';
import { ViewportLayout } from '@/components/viewport-layout';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import './globals.css';
import './easy.css';
import './messenger.css';
import './search.css';
import './downloads.css';
import './theme.css';
import './navigation.css';
import './saved-replies.css';
import './select.css';
import './voice.css';
import './responsive.css';

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const preference = cookieStore.get(THEME_KEY)?.value;
  const theme = isTheme(preference) ? preference : undefined;
  return (
    <html
      lang="fa"
      dir="rtl"
      data-theme={theme ?? 'light'}
      data-theme-preference={theme ?? 'system'}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={requestHeaders.get('x-nonce') ?? undefined}
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
      </head>
      <body>
        <ViewportLayout />
        <a className="skip-link" href="#main-content">
          رفتن به محتوای اصلی
        </a>
        {children}
      </body>
    </html>
  );
}
