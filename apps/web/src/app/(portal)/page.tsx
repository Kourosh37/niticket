import Link from 'next/link';
import {
  ArrowUpLeft,
  Plus,
  Ticket,
  Clock3,
  CheckCheck,
  MessageCircle,
  ArrowLeft,
  Building2,
  ShieldCheck,
  ChevronLeft,
} from 'lucide-react';
import { currentActor } from '@/lib/session';
import { db } from '@niticket/database';
import { listTickets } from '@niticket/core/application/tickets';
import { listDepartments } from '@niticket/core/application/administration';
import { TicketList } from '@/components/ticket-list';
import { Button } from '@/components/ui/button';
import { digits } from '@/lib/utils';
import { RoleDashboard } from '@/components/role-dashboard';
import { userRole } from '@niticket/core/domain/authorization';

export default async function Dashboard() {
  const actor = await currentActor();
  if (userRole(actor) !== 'STUDENT') return <RoleDashboard actor={actor} />;
  const [profile, groups, recent, departments] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } }),
    db.ticket.groupBy({ by: ['status'], where: { creatorId: actor.id }, _count: true }),
    listTickets(actor, { limit: 5, scope: 'mine' }),
    listDepartments(actor),
  ]);
  const total = groups.reduce((sum, g) => sum + g._count, 0);
  const count = (...statuses: string[]) =>
    groups.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count, 0);
  const stats = [
    {
      label: 'همه درخواست‌ها',
      count: total,
      icon: Ticket,
      color: 'green',
      detail: 'درخواست‌های ثبت‌شده شما',
    },
    {
      label: 'در حال پیگیری',
      count: count('OPEN', 'IN_PROGRESS', 'WAITING_FOR_DEPARTMENT', 'REOPENED'),
      icon: Clock3,
      color: 'blue',
      detail: 'در مسیر رسیدن به پاسخ',
    },
    {
      label: 'منتظر پاسخ شما',
      count: count('WAITING_FOR_USER'),
      icon: MessageCircle,
      color: 'orange',
      detail: 'با پاسخ شما ادامه پیدا می‌کند',
    },
    {
      label: 'حل‌شده',
      count: count('RESOLVED', 'CLOSED'),
      icon: CheckCheck,
      color: 'purple',
      detail: 'با همراهی واحدهای دانشگاه',
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> فضای ارتباطی شما با دانشگاه
          </div>
          <h1>
            سلام {profile.name.split(' ')[0]}، خوش آمدید <span className="greeting-dot">✦</span>
          </h1>
          <p>از اینجا درخواست‌های خود را ثبت کنید و در جریان پیگیری آن‌ها باشید.</p>
        </div>
        <Button asChild>
          <Link href="/tickets/new">
            <Plus size={18} /> درخواست جدید
          </Link>
        </Button>
      </div>
      <section className="welcome-panel">
        <div>
          <span className="welcome-label">
            <span /> یک مسیر ساده برای شنیده شدن
          </span>
          <h2>
            پاسخ سؤال شما،
            <br />
            از همین‌جا شروع می‌شود.
          </h2>
          <p>
            بدون مراجعه حضوری، با واحدهای دانشگاه در ارتباط باشید.
            <br className="desktop-only" /> ما کمک می‌کنیم درخواست شما به دست فرد درست برسد.
          </p>
          <Link href="/tickets/new" className="welcome-link">
            ثبت و پیگیری درخواست <ArrowLeft size={17} />
          </Link>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-ticket">
            <div className="art-ticket-top">
              <span className="art-icon">
                <MessageCircle size={25} />
              </span>
              <div>
                <i />
                <i />
              </div>
              <span className="art-check">
                <CheckCheck size={17} />
              </span>
            </div>
            <div className="art-lines">
              <i />
              <i />
              <i />
            </div>
            <div className="art-ticket-bottom">
              <span />
              <span />
              <span />
            </div>
          </div>
          <span className="floating-check">
            <ShieldCheck size={28} />
          </span>
          <span className="art-star">✳</span>
          <div className="art-mini">
            <span />
            <i />
            <CheckCheck size={14} />
          </div>
        </div>
      </section>
      <section className="stats-grid" aria-label="آمار درخواست‌های شما">
        {stats.map(({ label, count, icon: Icon, color, detail }) => (
          <article key={label} className="stat-card">
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon ${color}`}>
                <Icon size={20} />
              </span>
            </div>
            <strong>{digits(count)}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <section className="surface recent-section">
        <div className="section-heading">
          <div>
            <h2>آخرین درخواست‌ها</h2>
            <p>تازه‌ترین وضعیت ارتباط شما با دانشگاه</p>
          </div>
          <Link className="text-link" href="/tickets">
            مشاهده همه <ChevronLeft size={16} />
          </Link>
        </div>
        <TicketList tickets={recent.items} />
      </section>
      <div className="dashboard-bottom">
        <section className="surface department-section">
          <div className="section-heading">
            <div>
              <h2>واحدهای پاسخ‌گو</h2>
              <p>درخواست شما به کدام واحد مربوط است؟</p>
            </div>
            <Building2 size={21} className="muted" />
          </div>
          <div className="department-grid">
            {departments.length ? (
              departments.slice(0, 6).map((d, i) => (
                <Link
                  className="department-link"
                  key={d.id}
                  href={`/tickets/new?departmentId=${d.id}`}
                >
                  <span className={`department-icon color-${i % 3}`}>
                    <Building2 size={20} />
                  </span>
                  <span>
                    <b>{d.name}</b>
                    <small>
                      {d.acceptingTickets ? 'آماده دریافت درخواست' : 'پذیرش موقتاً غیرفعال'}
                    </small>
                  </span>
                  <ArrowUpLeft size={16} />
                </Link>
              ))
            ) : (
              <p className="small-empty">
                هنوز واحد پاسخ‌گویی فعال نشده است. مدیر سامانه می‌تواند واحدهای دانشگاه را اضافه
                کند.
              </p>
            )}
          </div>
        </section>
        <aside className="help-panel">
          <span className="help-icon">
            <MessageCircle size={24} />
          </span>
          <h3>
            یک درخواست خوب،
            <br />
            یک پاسخ دقیق‌تر.
          </h3>
          <p>
            موضوع را روشن بنویسید، جزئیات لازم را اضافه کنید و اگر نیاز بود، تصویر یا فایل بفرستید.
          </p>
          <Link href="/help">
            راهنمای ثبت درخواست <ArrowUpLeft size={16} />
          </Link>
        </aside>
      </div>
    </>
  );
}
