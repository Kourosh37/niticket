<div dir="rtl" align="right">

# نیتیکت

سامانه فارسی و راست‌چین برای گفتگو و پیگیری درخواست‌ها. کاربر با واحد موردنظر ارتباط می‌گیرد، مسئول واحد پاسخ می‌دهد و مدیر سامانه حساب‌ها، واحدها و تاریخچه را مدیریت می‌کند.

[امکانات](#features) · [معماری](#architecture) · [راه‌اندازی](#getting-started) · [امنیت](#security) · [استقرار](#deployment) · [تست](#testing)

<a id="features"></a>

## امکانات

- گفتگوی مداوم با متن، فایل و پیام صوتی؛ جستجو و صفحه‌بندی پیام‌های قدیمی.
- صندوق درخواست‌های منتظر پاسخ و پاسخ‌داده‌شده بر اساس آخرین پیام عمومی.
- اعلان خصوصی و تیک مشاهده؛ دیدن پیام، جای پاسخ مسئول را نمی‌گیرد.
- یادداشت‌های خصوصی، رویدادهای گفتگو و دسترسی نظارتی مدیر به تاریخچه.
- آپلود خصوصی، اسکن فایل و پیش‌نمایش تصویر، PDF، متن، Word و Excel.
- ورود موبایلی، رمز اختیاری، مدیریت نشست‌ها، تم روشن و تاریک و رابط واکنش‌گرا.

### نقش‌ها

<table dir="rtl">
  <thead>
    <tr><th align="right">نقش</th><th align="right">دسترسی</th></tr>
  </thead>
  <tbody>
    <tr><td>کاربر</td><td>ثبت و پیگیری گفتگوهای خود، ارسال پیام و پیوست و مشاهده پاسخ‌ها.</td></tr>
    <tr><td>مسئول واحد</td><td>پاسخ‌گویی در واحدهای مجاز و ثبت یادداشت خصوصی یا یادداشت رویداد.</td></tr>
    <tr><td>مدیر سامانه</td><td>مدیریت واحدها، مسئولان، حساب‌ها و تنظیمات؛ مشاهده گفتگو و تاریخچه به‌صورت فقط‌خواندنی.</td></tr>
  </tbody>
</table>

اعلان مسئول پس از پاسخ عمومی خوانده می‌شود؛ اعلان پاسخ برای کاربر با مشاهده همان پیام خوانده می‌شود. تیک مشاهده مستقل است و با دیدن پیام در نمای فعال ثبت می‌شود. گفتگوی خالی یا یادداشت خصوصی، پاسخ عمومی محسوب نمی‌شود.

<a id="architecture"></a>

## فناوری و معماری

<table dir="rtl">
  <thead>
    <tr><th align="right">بخش</th><th align="right">فناوری</th></tr>
  </thead>
  <tbody>
    <tr><td>زمان اجرا و زبان</td><td><bdi>Bun 1.4.4</bdi> و TypeScript</td></tr>
    <tr><td>وب</td><td><bdi>Next.js 16.4.5</bdi>، React 19 و App Router</td></tr>
    <tr><td>رابط</td><td>CSS، ابزارهای Tailwind 4، Radix UI، Lucide، Vazirmatn و React Virtuoso</td></tr>
    <tr><td>داده و صف</td><td>PostgreSQL 17، <bdi>Prisma 6.19.3</bdi>، Redis 7 و BullMQ</td></tr>
    <tr><td>هویت و اعتبارسنجی</td><td>Better Auth، Argon2id و Zod</td></tr>
    <tr><td>فایل و رسانه</td><td>S3 یا MinIO، ClamAV، FFmpeg، ffprobe و Sharp</td></tr>
    <tr><td>پیش‌نمایش</td><td>PDF.js، Mammoth، read-excel-file و fflate</td></tr>
    <tr><td>کیفیت و اجرا</td><td>Vitest، Testing Library، Playwright، ESLint، Prettier، Pino، Docker، Nginx و GitHub Actions</td></tr>
  </tbody>
</table>

پروژه یک مونوریپو با هسته ماژولار و Worker جداگانه است. وب و Worker از منطق مشترک `packages/core` استفاده می‌کنند؛ مدل داده و مهاجرت‌ها در `packages/database` قرار دارند. نسخه دقیق وابستگی‌ها در [bun.lock](bun.lock) ثبت شده است.

پیام و رویداد اعلان در یک تراکنش ثبت می‌شوند؛ الگوی Outbox انتقال رویداد به BullMQ را از درخواست وب جدا می‌کند. فایل‌ها پس از آپلود وارد قرنطینه می‌شوند و فقط بعد از بررسی نوع واقعی و اسکن، قابل دریافت‌اند. گفتگو با polling تازه می‌شود و نمایش پیام‌های طولانی مجازی است.

### ساختار مخزن

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

<a id="getting-started"></a>

## راه‌اندازی

پیش‌نیازها: Git، Docker Compose و نسخه Bun مشخص‌شده در [.bun-version](.bun-version). دستورها از ریشه مخزن اجرا می‌شوند.

<div dir="ltr" align="left">

```sh
bun install --frozen-lockfile
bun scripts/init-env.mjs
```

</div>

اسکریپت دوم فقط برای بار اول است و `.env` موجود را بازنویسی نمی‌کند. مقدار `ADMIN_PHONE` را در `.env` تنظیم کنید، سپس:

<div dir="ltr" align="left">

```sh
docker compose up -d --build --wait --wait-timeout 180 postgres redis minio clamav
bun run db:generate
bun run db:migrate
bun --env-file=.env scripts/init-storage.ts
bun run admin:bootstrap
docker compose build worker
docker compose up -d --no-deps --wait --wait-timeout 120 worker
bun run dev
```

</div>

وب در `http://localhost:3000` اجرا می‌شود. در محیط توسعه، کد ورود در لاگ وب نوشته می‌شود. برای اجرای کامل محلی با Docker، پس از تنظیم `.env` از `docker compose up -d --build --wait` استفاده کنید.

**اتصال پنل پیامک هنوز تکمیل نشده است.** مقدار `SMS_PROVIDER=log` برای توسعه است؛ انتخاب `panel` بدون پیاده‌سازی آداپتور [sms.ts](packages/core/src/infrastructure/sms.ts)، ارسال واقعی را فعال نمی‌کند.

### تنظیمات

مرجع متغیرها [.env.example](.env.example) و [config.ts](packages/core/src/infrastructure/config.ts) است:

- اتصال‌ها: `DATABASE_URL`، `REDIS_URL` و تنظیمات `S3_*` و `CLAMAV_*`.
- هویت: `BETTER_AUTH_SECRET`، `BETTER_AUTH_URL`، `APP_ORIGIN` و `ADMIN_PHONE`.
- سیاست‌ها: `SESSION_DAYS`، `MAX_UPLOAD_BYTES` و `MAX_VOICE_SECONDS`.

مقادیر سیاست ذخیره‌شده در پنل مدیریت بر پیش‌فرض‌های محیطی مقدم‌اند. `S3_PUBLIC_ENDPOINT` باید از مرورگر قابل دسترسی باشد؛ این نام به معنی عمومی‌بودن bucket نیست. اجرای Worker خارج از Docker به FFmpeg و ffprobe در `PATH` نیاز دارد.

<a id="security"></a>

## امنیت

- کنترل دسترسی در سرور بر اساس مالک گفتگو، عضویت فعال واحد و نقش حساب انجام می‌شود.
- OTP با digest در Redis، مهلت پنج‌دقیقه‌ای و محدودیت تلاش نگه‌داری می‌شود؛ رمزها با Argon2id هش می‌شوند.
- نشست‌ها از کوکی `HttpOnly` استفاده می‌کنند و عملیات حساس تأیید هویت تازه می‌خواهند.
- Origin، ورودی‌ها، نرخ درخواست و نسخه گفتگو برای تغییرات هم‌زمان بررسی می‌شوند.
- دریافت فایل به مجوز و وضعیت `CLEAN` وابسته است؛ لینک آپلود کوتاه‌عمر به حجم فایل مقید است.
- CSP، هدرهای امنیتی، تاریخچه مدیریتی و لاگ ساختاریافته در نظر گرفته شده‌اند.

رازها، فایل‌های محیطی، کلید TLS و لاگ OTP را منتشر نکنید. bucket خصوصی، کلیدهای محدود و سرویس‌های به‌روز برای محیط واقعی ضروری‌اند.

<a id="deployment"></a>

## استقرار

فایل [docker-compose.prod.yml](docker-compose.prod.yml) وب، Worker، PostgreSQL، Redis، ClamAV، مهاجرت و Nginx را اجرا می‌کند. Storage باید جداگانه فراهم شود؛ تنها Nginx ورودی عمومی دارد.

1. `.env.production` را با دامنه HTTPS، رازهای جدید، پیامک واقعی و endpointهای Storage آماده کنید.
2. `MIGRATION_DATABASE_URL` و `RUNTIME_DATABASE_URL` را برای دو نقش جدا تنظیم کنید؛ نقش runtime مالک schema نباشد و مجوز تغییر `AuditLog` نداشته باشد.
3. مسیرهای معتبر `TLS_CERT_PATH` و `TLS_KEY_PATH` را تعیین کنید.
4. imageها را بسازید و پس از آماده‌سازی نقش‌های دیتابیس، مهاجرت و Storage را راه‌اندازی کنید.

<div dir="ltr" align="left">

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait postgres redis clamav
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps migrate

docker build --target tools -t niticket-tools:deploy -f infrastructure/docker/Dockerfile .
docker run --rm --env-file .env.production niticket-tools:deploy bun scripts/init-storage.ts

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait web worker proxy
```

</div>

URLهای اتصال داخل Compose باید از میزبان `postgres` استفاده کنند. پس از مهاجرت، مجوز جدول‌ها و sequenceها را به نقش runtime بدهید و مجوز تغییر یا حذف `AuditLog` را لغو کنید. کلید راه‌اندازی Storage به مجوز تنظیم bucket، CORS، versioning و lifecycle نیاز دارد؛ برای MinIO خارجی، CORS مبدأ وب را روی همان سرویس تنظیم کنید.

وب و Worker با Bun اجرا می‌شوند. مقدار `runtime = 'nodejs'` در فایل‌های Next.js قرارداد چارچوب است و نباید به `bun` تغییر کند.

### نگه‌داری

- `/api/health/ready` اتصال پایگاه و Redis را بررسی می‌کند؛ سلامت پیامک، Storage و اسکنر را جداگانه بسنجید.
- وضعیت Worker، شکست‌های صف و مصرف Redis و Storage را پایش کنید؛ API مدیر برای صف در `/api/v1/admin/jobs` است.
- از PostgreSQL و فایل‌های Storage پشتیبان هماهنگ بگیرید و بازیابی را در محیط جدا آزمایش کنید. versioning جای بکاپ نیست؛ lifecycle این پروژه نسخه‌های غیرجاری را پس از یک روز حذف‌پذیر می‌کند.

<a id="testing"></a>

## توسعه و تست

تست‌ها به پایگاه جداگانه با نام منتهی به `_test` نیاز دارند. در اولین اجرا آن را بسازید؛ اگر موجود است، دستور ایجاد را تکرار نکنید:

<div dir="ltr" align="left">

```sh
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" niticket_test'
bun --env-file=.env scripts/test-database.mjs

bun run format:check
bun run typecheck
bun run lint
bun run test
bun run test:integration
bun run build
bun --bun playwright install chromium
bun run test:e2e
bun audit --prod --audit-level=high
```

</div>

تست مرورگر روی پورت `3001` و build تولیدی اجرا می‌شود؛ Worker همین نسخه باید فعال باشد. در لینوکس ممکن است نصب مرورگر با `--with-deps` لازم باشد. گزارش‌ها در `playwright-report/` و `test-results/` تولید می‌شوند و وارد Git نمی‌شوند.

[گردش CI](.github/workflows/ci.yml) بررسی کیفیت، تست‌ها، ممیزی وابستگی و ساخت Docker را اجرا می‌کند. قواعد کسب‌وکار را در هسته نگه دارید و تغییر مدل داده را با مهاجرت جدید ثبت کنید. فایل‌های تولیدی، `node_modules` و رازهای محیطی نباید کامیت شوند.

## مراجع کد

[مدل داده](packages/database/prisma/schema.prisma) · [کنترل دسترسی](packages/core/src/domain/authorization.ts) · [API](packages/core/src/http/router.ts) · [پردازش صف](packages/core/src/application/jobs.ts) · [تنظیمات](.env.example)

## مجوز

فایل `LICENSE` در مخزن تعریف نشده است؛ نوع مجوز انتشار باید توسط مالک پروژه مشخص شود.

</div>
