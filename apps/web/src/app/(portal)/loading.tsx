export default function Loading() {
  return (
    <div aria-label="در حال بارگذاری" role="status">
      <div className="skeleton" style={{ height: 65, marginBottom: 25 }} />
      <div className="skeleton" style={{ height: 230, marginBottom: 25 }} />
      <div className="loading-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
      <span className="sr-only">در حال بارگذاری…</span>
    </div>
  );
}
