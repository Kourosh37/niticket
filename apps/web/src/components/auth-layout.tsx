import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page auth-simple" id="main-content">
      <div className="auth-theme-control">
        <ThemeToggle />
      </div>
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
        <h1>راه ساده گفت‌وگو با دانشگاه</h1>
      </section>
      <section className="auth-form-area">{children}</section>
    </main>
  );
}
