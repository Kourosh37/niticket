import { GraduationCap } from 'lucide-react';
import Link from 'next/link';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-story">
        <Link href="/login" className="brand">
          <span className="brand-mark">
            <GraduationCap size={25} />
          </span>
          <span>
            <strong>
              نیتیکت<span className="brand-dot">.</span>
            </strong>
            <small>سامانه پشتیبانی دانشگاه</small>
          </span>
        </Link>
        <h1>
          ارتباطی روشن.
          <br />
          همراهی تا رسیدن به پاسخ.
        </h1>
        <p>یک فضای یکپارچه برای طرح پرسش‌ها، پیگیری درخواست‌ها و ارتباط با واحدهای دانشگاه.</p>
      </section>
      <section className="auth-form-area">{children}</section>
    </main>
  );
}
