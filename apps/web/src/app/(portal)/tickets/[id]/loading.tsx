export default function Loading() {
  return (
    <div
      className="messenger-chat messenger-skeleton"
      role="status"
      aria-label="در حال بارگذاری گفتگو"
      aria-busy="true"
    >
      <span className="sr-only">در حال دریافت پیام‌های گفتگو…</span>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
