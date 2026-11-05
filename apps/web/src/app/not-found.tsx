import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main-content" className="empty-state">
      <span className="empty-icon">۴۰۴</span>
      <h1>این صفحه پیدا نشد</h1>
      <p>ممکن است نشانی تغییر کرده باشد یا به این بخش دسترسی نداشته باشید.</p>
      <Link className="button button-primary" href="/">
        بازگشت به خانه
      </Link>
    </main>
  );
}
