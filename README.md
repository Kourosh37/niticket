<div dir="rtl" align="center">

# 🎫 نیتیکت

### سامانه فارسی گفتگو و مدیریت درخواست‌ها

**یک پلتفرم مدرن، امن و واکنش‌گرا برای ارتباط کاربران با واحدهای سازمانی**

سامانه‌ای برای ثبت، مدیریت و پیگیری گفتگوها و درخواست‌ها، با پشتیبانی از پیام متنی، صوتی، فایل و مدیریت متمرکز واحدها.

<br>

### ⚡ تکنولوژی‌های مورد استفاده

<img src="https://skillicons.dev/icons?i=nextjs,react,ts,bun,postgres,redis,prisma,docker,nginx,tailwind,git,github&perline=6" alt="Technology Stack">

<br>

<img src="https://img.shields.io/badge/Next.js-16.4.5-black?style=flat-square&logo=nextdotjs" alt="Next.js">
<img src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white" alt="React">
<img src="https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
<img src="https://img.shields.io/badge/Bun-1.4.4-f9f1e1?style=flat-square&logo=bun&logoColor=black" alt="Bun">
<img src="https://img.shields.io/badge/PostgreSQL-17-4169e1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
<img src="https://img.shields.io/badge/Redis-7-dc382d?style=flat-square&logo=redis&logoColor=white" alt="Redis">
<img src="https://img.shields.io/badge/Prisma-6.19.3-2d3748?style=flat-square&logo=prisma" alt="Prisma">
<img src="https://img.shields.io/badge/Docker-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker">

<br>
<br>

[امکانات](#features) •
[معماری](#architecture) •
[راه‌اندازی](#getting-started) •
[امنیت](#security) •
[استقرار](#deployment) •
[تست](#testing)

</div>

---

<div dir="rtl" align="right">

<a id="features"></a>

## ✨ امکانات

نیتیکت با هدف ساده‌سازی ارتباط میان کاربران، مسئولان واحدها و مدیران سامانه طراحی شده است.

<ul dir="rtl" style="direction: rtl; text-align: right; padding-right: 24px; padding-left: 0;">
  <li>💬 گفتگوی مداوم با متن، فایل و پیام صوتی؛ جستجو و صفحه‌بندی پیام‌های قدیمی.</li>
  <li>📥 صندوق درخواست‌های منتظر پاسخ و پاسخ‌داده‌شده بر اساس آخرین پیام عمومی.</li>
  <li>🔔 اعلان خصوصی و تیک مشاهده؛ دیدن پیام، جای پاسخ مسئول را نمی‌گیرد.</li>
  <li>📝 یادداشت‌های خصوصی، رویدادهای گفتگو و دسترسی نظارتی مدیر به تاریخچه.</li>
  <li>📁 آپلود خصوصی، اسکن فایل و پیش‌نمایش تصویر، PDF، متن، Word و Excel.</li>
  <li>🔐 ورود موبایلی، رمز اختیاری و مدیریت نشست‌ها.</li>
  <li>🔖 پیام‌های آماده ویژه هر واحد با متن، صدا، عکس، ویدیو و سند؛ مدیریت جداگانه و انتخاب و جستجو داخل گفتگو.</li>
  <li>🎨 تم روشن و تاریک، رابط فارسی و طراحی واکنش‌گرا.</li>
</ul>

### 👥 نقش‌های کاربری

<table dir="rtl" style="width: 100%; text-align: right;">
  <thead>
    <tr>
      <th style="text-align: right;">نقش</th>
      <th style="text-align: right;">دسترسی‌ها</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>👤 کاربر</td>
      <td>ثبت و پیگیری گفتگوهای خود، ارسال پیام و پیوست و مشاهده پاسخ‌ها.</td>
    </tr>
    <tr>
      <td>🧑‍💼 مسئول واحد</td>
      <td>پاسخ‌گویی در واحدهای مجاز و ثبت یادداشت خصوصی یا یادداشت رویداد.</td>
    </tr>
    <tr>
      <td>🛡️ مدیر سامانه</td>
      <td>مدیریت واحدها، مسئولان، حساب‌ها و تنظیمات؛ مشاهده گفتگو و تاریخچه به‌صورت فقط‌خواندنی.</td>
    </tr>
  </tbody>
</table>

> **نکته:** اعلان مسئول پس از پاسخ عمومی خوانده می‌شود؛ اعلان پاسخ برای کاربر با مشاهده همان پیام خوانده می‌شود. تیک مشاهده مستقل است و با دیدن پیام در نمای فعال ثبت می‌شود. گفتگوی خالی یا یادداشت خصوصی، پاسخ عمومی محسوب نمی‌شود.

---

<a id="architecture"></a>

## 🏗️ فناوری و معماری

پروژه به‌صورت **Monorepo** با هسته ماژولار و Worker مستقل طراحی شده است.

### 🧩 پشته فناوری

<table dir="rtl" style="width: 100%; text-align: right;">
  <thead>
    <tr>
      <th style="text-align: right;">بخش</th>
      <th style="text-align: right;">فناوری</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>⚡ زمان اجرا و زبان</td><td><bdi>Bun 1.4.4</bdi> و TypeScript</td></tr>
    <tr><td>🌐 وب</td><td><bdi>Next.js 16.4.5</bdi>، React 19 و App Router</td></tr>
    <tr><td>🎨 رابط کاربری</td><td>CSS، Tailwind 4، Radix UI، Lucide، Vazirmatn و React Virtuoso</td></tr>
    <tr><td>🗄️ داده و صف</td><td>PostgreSQL 17، <bdi>Prisma 6.19.3</bdi>، Redis 7 و BullMQ</td></tr>
    <tr><td>🔐 هویت و اعتبارسنجی</td><td>Better Auth، Argon2id و Zod</td></tr>
    <tr><td>📦 فایل و رسانه</td><td>S3 یا MinIO، ClamAV، FFmpeg، ffprobe و Sharp</td></tr>
    <tr><td>📄 پیش‌نمایش</td><td>PDF.js، Mammoth، read-excel-file و fflate</td></tr>
    <tr><td>🧪 کیفیت و اجرا</td><td>Vitest، Testing Library، Playwright، ESLint، Prettier، Pino، Docker، Nginx و GitHub Actions</td></tr>
  </tbody>
</table>

### 🔄 معماری سامانه

وب و Worker از منطق مشترک `packages/core` استفاده می‌کنند و مدل داده و مهاجرت‌ها در `packages/database` قرار دارند.

نسخه دقیق وابستگی‌ها در [bun.lock](bun.lock) ثبت شده است.

پیام و رویداد اعلان در یک تراکنش ثبت می‌شوند؛ الگوی **Outbox** انتقال رویداد به BullMQ را از درخواست وب جدا می‌کند.

فایل‌ها پس از آپلود وارد قرنطینه می‌شوند و فقط بعد از بررسی نوع واقعی و اسکن، قابل دریافت‌اند.

ارسال پیام و فایل با HTTP انجام می‌شود و دریافت تغییرات با یک اتصال مشترک SSE در هر تب است. پس از قطع و وصل ارتباط، داده‌ها از HTTP بازخوانی می‌شوند؛ polling محدود نیز برای بازیابی حفظ شده است. نمایش پیام‌های طولانی مجازی است.

### 📂 ساختار مخزن

<div dir="ltr" align="left">

```text
niticket/
├── apps/
│   ├── web/src/
│   │   ├── app/              # صفحات، مسیرهای API و سبک‌ها
│   │   ├── components/       # گفتگو، مدیریت و اجزای رابط
│   │   ├── lib/              # ابزارهای مرورگر و متن نقش‌ها
│   │   └── workers/          # پردازش پیش‌نمایش Office
│   └── worker/src/           # اجرای پردازش پس‌زمینه
├── packages/
│   ├── core/src/
│   │   ├── domain/           # قواعد دسترسی و دامنه
│   │   ├── application/      # عملیات گفتگو، حساب، فایل و صف
│   │   ├── infrastructure/   # اتصال سرویس‌ها و پردازش رسانه
│   │   ├── http/             # مسیریابی و پوشش مشترک API
│   │   └── validation/       # قراردادهای ورودی
│   └── database/
│       ├── prisma/           # مدل داده و مهاجرت‌ها
│       └── src/              # Prisma Client مشترک
├── infrastructure/           # Dockerfileها و تنظیم Nginx
├── scripts/                  # راه‌اندازی، مهاجرت و بررسی عملیاتی
├── tests/                    # واحد، یکپارچه، مرورگر و سنجش بار
├── .github/workflows/        # بررسی کیفیت در CI
├── .env.example              # نمونه تنظیمات محیطی
├── docker-compose.yml        # اجرای محلی
└── docker-compose.prod.yml   # استقرار production
```

</div>

---

<a id="getting-started"></a>

## 🚀 راه‌اندازی

### 📋 پیش‌نیازها

Git، Docker Compose و نسخه Bun مشخص‌شده در [.bun-version](.bun-version).

تمام دستورها باید از ریشه مخزن اجرا شوند.

### ۱. نصب وابستگی‌ها

<div dir="ltr" align="left">

```bash
bun install --frozen-lockfile
bun scripts/init-env.mjs
```

</div>

اسکریپت دوم فقط برای بار اول است و `.env` موجود را بازنویسی نمی‌کند.

### ۲. تنظیم محیط

مقدار `ADMIN_PHONE` را در فایل `.env` تنظیم کنید.

### ۳. راه‌اندازی سرویس‌ها

<div dir="ltr" align="left">

```bash
docker compose up -d --build --wait --wait-timeout 180 postgres redis cache minio clamav

bun run db:generate
bun run db:migrate

bun --env-file=.env scripts/init-storage.ts
bun run admin:bootstrap

docker compose build worker
docker compose up -d --no-deps --wait --wait-timeout 120 worker media-worker

bun run dev
```

</div>

### ۴. دسترسی به سامانه

پس از اجرای موفق سرویس‌ها، وب در آدرس زیر اجرا می‌شود:

<div dir="ltr" align="center">

**http://localhost:3000**

</div>

در محیط توسعه، کد ورود در لاگ وب نوشته می‌شود.

برای اجرای کامل محلی با Docker، پس از تنظیم `.env` از دستور زیر استفاده کنید:

<div dir="ltr" align="left">

```bash
docker compose up -d --build --wait
```

</div>

> ⚠️ **وضعیت پیامک:** اتصال پنل پیامک هنوز تکمیل نشده است. مقدار `SMS_PROVIDER=log` برای توسعه است؛ انتخاب `panel` بدون پیاده‌سازی آداپتور [sms.ts](packages/core/src/infrastructure/sms.ts)، ارسال واقعی را فعال نمی‌کند.

### ⚙️ تنظیمات محیطی

مرجع متغیرها [.env.example](.env.example) و [config.ts](packages/core/src/infrastructure/config.ts) است.

<ul dir="rtl" style="direction: rtl; text-align: right; padding-right: 24px; padding-left: 0;">
  <li>اتصال‌ها: <code>DATABASE_URL</code>، <code>REDIS_URL</code> و تنظیمات <code>S3_*</code> و <code>CLAMAV_*</code>.</li>
  <li>هویت: <code>BETTER_AUTH_SECRET</code>، <code>BETTER_AUTH_URL</code>، <code>APP_ORIGIN</code> و <code>ADMIN_PHONE</code>.</li>
  <li>سیاست‌ها: <code>SESSION_DAYS</code>، <code>MAX_UPLOAD_BYTES</code> و <code>MAX_VOICE_SECONDS</code>.</li>
</ul>

مقادیر سیاست ذخیره‌شده در پنل مدیریت بر پیش‌فرض‌های محیطی مقدم‌اند.

`S3_PUBLIC_ENDPOINT` باید از مرورگر قابل دسترسی باشد؛ این نام به معنی عمومی‌بودن bucket نیست.

اجرای Worker خارج از Docker به FFmpeg و ffprobe در `PATH` نیاز دارد.

---

<a id="security"></a>

## 🛡️ امنیت

امنیت نیتیکت بر کنترل دسترسی سمت سرور، مدیریت نشست‌ها و اعتبارسنجی فایل‌ها متکی است.

<ul dir="rtl" style="direction: rtl; text-align: right; padding-right: 24px; padding-left: 0;">
  <li>🔒 کنترل دسترسی بر اساس مالک گفتگو، عضویت فعال واحد و نقش حساب.</li>
  <li>🔑 OTP با digest در Redis، مهلت پنج‌دقیقه‌ای و محدودیت تلاش؛ هش رمزها با Argon2id.</li>
  <li>🍪 نشست‌ها با کوکی <code>HttpOnly</code> و الزام تأیید هویت تازه برای عملیات حساس.</li>
  <li>🚦 بررسی Origin، ورودی‌ها، نرخ درخواست و نسخه گفتگو برای تغییرات هم‌زمان.</li>
  <li>🦠 دریافت فایل وابسته به مجوز و وضعیت <code>CLEAN</code>؛ لینک آپلود کوتاه‌عمر و مقید به حجم فایل.</li>
  <li>📋 CSP، هدرهای امنیتی، تاریخچه مدیریتی و لاگ ساختاریافته.</li>
</ul>

> ⚠️ رازها، فایل‌های محیطی، کلید TLS و لاگ OTP را منتشر نکنید. bucket خصوصی، کلیدهای محدود و سرویس‌های به‌روز برای محیط واقعی ضروری‌اند.

---

<a id="deployment"></a>

## 🐳 استقرار

فایل [docker-compose.prod.yml](docker-compose.prod.yml) سرویس‌های وب، Worker، PostgreSQL، Redis، ClamAV، مهاجرت و Nginx را اجرا می‌کند.

Storage باید جداگانه فراهم شود و تنها Nginx ورودی عمومی دارد.

### مراحل استقرار

<ol dir="rtl" style="direction: rtl; text-align: right; padding-right: 24px; padding-left: 0;">
  <li>فایل <code>.env.production</code> را با دامنه HTTPS، رازهای جدید، پیامک واقعی و endpointهای Storage آماده کنید.</li>
  <li>متغیرهای <code>MIGRATION_DATABASE_URL</code> و <code>RUNTIME_DATABASE_URL</code> را برای دو نقش جدا تنظیم کنید؛ نقش runtime مالک schema نباشد و مجوز تغییر <code>AuditLog</code> نداشته باشد.</li>
  <li>مسیرهای معتبر <code>TLS_CERT_PATH</code> و <code>TLS_KEY_PATH</code> را تعیین کنید.</li>
  <li>imageها را بسازید و پس از آماده‌سازی نقش‌های دیتابیس، مهاجرت و Storage را راه‌اندازی کنید.</li>
</ol>

<div dir="ltr" align="left">

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait postgres redis cache clamav

docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps migrate

docker build --target tools -t niticket-tools:deploy -f infrastructure/docker/Dockerfile .

docker run --rm --env-file .env.production niticket-tools:deploy bun scripts/init-storage.ts

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait web worker media-worker proxy
```

</div>

URLهای اتصال داخل Compose باید از میزبان `postgres` استفاده کنند.

پس از مهاجرت، مجوز جدول‌ها و sequenceها را به نقش runtime بدهید و مجوز تغییر یا حذف `AuditLog` را لغو کنید.

کلید راه‌اندازی Storage به مجوز تنظیم bucket، CORS، versioning و lifecycle نیاز دارد؛ برای MinIO خارجی، CORS مبدأ وب را روی همان سرویس تنظیم کنید.

وب و Worker با Bun اجرا می‌شوند. مقدار `runtime = 'nodejs'` در فایل‌های Next.js قرارداد چارچوب است و نباید به `bun` تغییر کند.

### 🔧 نگه‌داری

<ul dir="rtl" style="direction: rtl; text-align: right; padding-right: 24px; padding-left: 0;">
  <li>❤️ مسیر <code>/api/health/ready</code> اتصال پایگاه و Redis را بررسی می‌کند؛ سلامت پیامک، Storage و اسکنر را جداگانه بسنجید.</li>
  <li>📊 وضعیت Worker، شکست‌های صف و مصرف Redis و Storage را پایش کنید؛ API مدیر برای صف در <code>/api/v1/admin/jobs</code> است.</li>
  <li>💾 از PostgreSQL و فایل‌های Storage پشتیبان هماهنگ بگیرید و بازیابی را در محیط جدا آزمایش کنید. versioning جای بکاپ نیست؛ lifecycle این پروژه نسخه‌های غیرجاری را پس از یک روز حذف‌پذیر می‌کند.</li>
</ul>

---

<a id="testing"></a>

پایش مدیر در `GET /api/v1/admin/metrics` تأخیر Outbox، شکست هر دو صف، عقب‌ماندگی پاک‌سازی Storage و هشدارهای قابل پیگیری را برمی‌گرداند. شمارنده‌های کش و زمان جستجو مربوط به همان پردازه‌اند؛ Worker نیز آمار پردازهٔ خودش را هر دقیقه در لاگ ساختاریافته ثبت می‌کند. متن پیام و اطلاعات اتصال وارد این آمار نمی‌شود.

رویدادهای تکمیل‌شدهٔ Outbox پس از `OUTBOX_RETENTION_DAYS` روز (پیش‌فرض ۳۰، حداقل ۷) در دسته‌های حداکثر ۲۰۰تایی پاک می‌شوند. رویدادهای معلق و شکست‌خورده، گفتگوها، فایل‌های مرجع‌دار، AuditLog و کلیدهای idempotency حفظ می‌شوند. برای پیش‌نمایش دستی `bun --env-file=.env scripts/retention.ts` و برای اجرای یک دسته همین دستور با `--apply` در دسترس است. آرشیو یا حذف محتوای گفتگو باید بر اساس سیاست نگهداری سازمان جداگانه تعیین شود.

## 🧪 توسعه و تست

دستورهای تست یکپارچه و مرورگر برای هر اجرا پایگاه داده، bucket و صف جدا می‌سازند و پس از پایان همان منابع را پاک می‌کنند. حساب دیتابیس تست باید مجوز ساخت پایگاه داشته باشد؛ در صورت نیاز `TEST_ADMIN_DATABASE_URL` را جدا تنظیم کنید. اطلاعات محیط اصلی حذف نمی‌شود.

<div dir="ltr" align="left">

```bash
# تست‌های رسانه به Worker ساخته‌شده از همین نسخه و FFmpeg داخل آن نیاز دارند.
docker compose up -d --wait cache
docker compose build worker
docker compose up -d --no-deps --wait --wait-timeout 120 worker media-worker

bun run format:check
bun run typecheck
bun run lint
bun run test
bun run test:integration
bun run build

bun --bun playwright install chromium webkit
bun run test:e2e
bun run test:e2e:webkit

bun audit --prod --audit-level=high
```

</div>

تست مرورگر روی پورت `3001` و build تولیدی اجرا می‌شود؛ Worker همین نسخه باید فعال باشد.

در لینوکس ممکن است نصب مرورگر با `--with-deps` لازم باشد.

گزارش‌ها در `playwright-report/` و `test-results/` تولید می‌شوند و وارد Git نمی‌شوند.

[گردش CI](.github/workflows/ci.yml) بررسی کیفیت، تست‌ها، ممیزی وابستگی و ساخت Docker را اجرا می‌کند.

قواعد کسب‌وکار را در هسته نگه دارید و تغییر مدل داده را با مهاجرت جدید ثبت کنید.

فایل‌های تولیدی، `node_modules` و رازهای محیطی نباید کامیت شوند.

---

## 📚 مراجع کد

[مدل داده](packages/database/prisma/schema.prisma) ·
[کنترل دسترسی](packages/core/src/domain/authorization.ts) ·
[API](packages/core/src/http/router.ts) ·
[پردازش صف](packages/core/src/application/jobs.ts) ·
[تنظیمات](.env.example)

</div>
