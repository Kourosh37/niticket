'use client';

import { Button } from '@/components/ui/button';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <span className="empty-icon">!</span>
      <h1>دریافت اطلاعات انجام نشد</h1>
      <p>ممکن است ارتباط با سامانه موقتاً قطع شده باشد. دوباره تلاش کنید.</p>
      <Button onClick={reset}>تلاش دوباره</Button>
    </div>
  );
}
