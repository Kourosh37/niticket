# راه‌اندازی و استقرار

> اجرای محلی، Docker، متغیرهای محیطی و نگهداری نیتیکت

[معرفی پروژه](README.md) · [فناوری و معماری](TECHNICAL.md)

---

## ۱. اجرای محلی با Docker

به Node.js 24، pnpm 11.5.1، Docker Desktop یا Docker Engine همراه Compose نیاز دارید. ساخت اولیه به اینترنت و حافظهٔ کافی برای بیلد و ClamAV نیاز دارد؛ حدود ۸ گیگابایت حافظهٔ آزاد مناسب است.

در ریشهٔ پروژه اجرا کنید:

```sh
node scripts/init-env.mjs
pnpm install --frozen-lockfile
pnpm db:generate
docker compose up -d --build
docker compose ps
```

اسکریپت محیط، `.env` را با رمزهای تصادفی سرویس‌های محلی می‌سازد و فایل موجود را بازنویسی نمی‌کند. حساب کاربری ایجاد نمی‌شود. روش جایگزین، کپی `.env.example` به `.env` و جایگزینی همهٔ مقادیر `CHANGE_ME` است.

ساخت اولیهٔ MinIO و دریافت امضاهای ClamAV ممکن است چند دقیقه طول بکشد. در سیستم کم‌حافظه، تصاویر وب و worker را جداگانه بسازید. آماده‌سازی مخزن خصوصی و مهاجرت پایگاه داده قبل از اجرای برنامه انجام می‌شود.

| نشانی محلی              | کاربرد                      |
| ----------------------- | --------------------------- |
| <http://localhost:3000> | سامانه                      |
| <http://localhost:9001> | کنسول ذخیره‌سازی برای توسعه |
| <http://localhost:3001> | سرور موقت آزمون مرورگر      |

**مدیر اولیه:** شماره موبایل ایرانی مدیر را در `ADMIN_PHONE` در `.env` تنظیم کنید. مدیر از صفحهٔ ورود کد می‌گیرد؛ پس از تأیید شماره، دسترسی مدیر فعال می‌شود. ساخت حساب با ایمیل و رمز اولیه لازم نیست.

فعلاً `SMS_PROVIDER=log` است. برای دیدن کد ورود محلی:

```sh
docker compose logs -f web
```

کد با رویداد `sms.otp` ثبت می‌شود. پنل پیامکی در `packages/core/src/infrastructure/sms.ts` هنوز پیاده‌سازی نشده است؛ قبل از ارسال واقعی، تابع اتصال را تکمیل و `SMS_PROVIDER=panel` را فعال کنید. دسترسی به لاگ‌های حاوی کد باید به تیم توسعه محدود باشد.

## ۲. اجرای وب خارج از Docker

```sh
docker compose stop web worker
docker compose up -d postgres redis minio clamav
pnpm db:generate
pnpm db:migrate
pnpm exec tsx --env-file=.env scripts/init-storage.ts
pnpm dev
```

برای پردازش فایل و اعلان‌ها، worker را در ترمینال دیگر اجرا کنید:

```sh
pnpm worker
```

این روش به `ffmpeg` و `ffprobe` در PATH سیستم نیاز دارد. جایگزین آن، worker داکری است که هر دو ابزار را دارد:

```sh
docker compose build worker
docker compose up -d --no-deps worker
```

## ۳. متغیرهای محیطی

مرجع نام‌ها و مقادیر نمونه، [فایل `.env.example`](.env.example) است. `.env` و `.env.production` وارد Git یا تصاویر Docker نمی‌شوند.

| گروه         | متغیرها                                                                                                        | نکته                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| پایگاه داده  | `POSTGRES_USER`، `POSTGRES_PASSWORD`، `POSTGRES_DB`، `DATABASE_URL`                                            | در میزبان از `127.0.0.1` و داخل Compose از `postgres` استفاده می‌شود |
| هویت و دامنه | `BETTER_AUTH_SECRET`، `BETTER_AUTH_URL`، `APP_ORIGIN`                                                          | کلید تصادفی حداقل ۳۲ نویسه؛ دو نشانی دقیقاً مطابق دامنهٔ سامانه      |
| صف           | `REDIS_URL`، `QUEUE_NAME`                                                                                      | نام صف آزمون از صف اصلی جداست                                        |
| ذخیره‌سازی   | `S3_ENDPOINT`، `S3_PUBLIC_ENDPOINT`، `S3_PROVIDER`، `S3_REGION`، `S3_BUCKET`، `S3_ACCESS_KEY`، `S3_SECRET_KEY` | نشانی عمومی باید از مرورگر قابل دسترسی باشد؛ مخزن خصوصی می‌ماند      |
| اسکنر        | `CLAMAV_HOST`، `CLAMAV_PORT`                                                                                   | پورت پیش‌فرض ۳۳۱۰؛ داخل Docker نام سرویس `clamav`                    |
| ورود موبایلی | `ADMIN_PHONE`، `SMS_PROVIDER`، `SESSION_DAYS`                                                                  | شماره مدیر؛ فعلاً کد در لاگ؛ نشست پیش‌فرض ۳۰ روز                     |
| سیاست اولیه  | `MAX_UPLOAD_BYTES`، `MAX_VOICE_SECONDS`، `REOPEN_DAYS`                                                         | پیش‌فرض: ۱۰ مگابایت، ۱۸۰ ثانیه و ۷ روز                               |

نام دانشگاه، توضیح سامانه، سیاست فایل/صدا در پنل مدیر قابل ذخیره‌اند. پس از ذخیره، تنظیمات پایگاه داده بر پیش‌فرض‌های محیط اولویت دارند. هیچ راز یا کلید خصوصی را در متغیرهای `NEXT_PUBLIC_*` قرار ندهید.

## ۴. استقرار روی سرور

فایل `docker-compose.prod.yml` شامل وب، worker، PostgreSQL، Redis، ClamAV و Nginx با HTTPS است. فقط پورت‌های ۸۰ و ۴۴۳ منتشر می‌شوند. ذخیره‌سازی و پنل پیامکی باید بیرون از این مجموعه آماده باشند؛ MinIO محلی برای توسعه است.

فایل `.env.production` را از روی نمونه آماده و این موارد را اضافه یا اصلاح کنید:

```dotenv
APP_ORIGIN=https://support.example.com
BETTER_AUTH_URL=https://support.example.com
S3_PROVIDER=s3
CLAMAV_HOST=clamav
DATABASE_URL=postgresql://niticket_app:CHANGE_ME@postgres:5432/niticket
RUNTIME_DATABASE_URL=postgresql://niticket_app:CHANGE_ME@postgres:5432/niticket
MIGRATION_DATABASE_URL=postgresql://niticket_owner:CHANGE_ME@postgres:5432/niticket
TLS_CERT_PATH=/secure/tls/fullchain.pem
TLS_KEY_PATH=/secure/tls/privkey.pem
ADMIN_PHONE=
SMS_PROVIDER=log
SESSION_DAYS=30
```

نشانی‌ها و مقادیر بالا نمونه‌اند. `POSTGRES_USER` و رمز اولیهٔ پایگاه داده باید با نقش مالک مهاجرت هماهنگ باشند. برای برنامه یک نقش جدا با دسترسی محدود بسازید؛ حساب اجرای برنامه نباید مالک ساختار یا superuser باشد.

پیش از انتشار:

1. DNS، گواهی معتبر HTTPS و تمدید گواهی را آماده کنید.
2. مخزن S3 خصوصی، کلید محدود، رمزنگاری، نسخه‌بندی و CORS محدود به `APP_ORIGIN` را تنظیم کنید. مرورگر باید بتواند PUT امضاشده بفرستد.
3. اتصال پنل پیامکی را تکمیل کنید؛ ارسال، انقضا، محدودیت تلاش و مصرف یک‌بارهٔ کد را بررسی کنید.
4. پایگاه داده را بالا بیاورید، مهاجرت را با نقش مالک اجرا کنید و دسترسی نقش برنامه را بدهید.

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml build migrate
docker compose --env-file .env.production -f docker-compose.prod.yml build web
docker compose --env-file .env.production -f docker-compose.prod.yml build worker
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis clamav
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
```

<details>
<summary>دسترسی پیشنهادی نقش برنامه در PostgreSQL</summary>

با نقش مالک در ترمینال `psql` اجرا کنید و رمز واقعی را با `\password` تعیین کنید. نام‌ها را مطابق محیط خودتان تغییر دهید.

```sql
CREATE ROLE niticket_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password niticket_app
GRANT CONNECT ON DATABASE niticket TO niticket_app;
GRANT USAGE ON SCHEMA public TO niticket_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO niticket_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO niticket_app;
REVOKE UPDATE ON TABLE "AuditLog" FROM niticket_app;
GRANT DELETE ON TABLE "Session", "Verification" TO niticket_app;
```

این دسترسی‌ها را بعد از مهاجرت‌های جدید بازبینی و ورود با OTP، تعیین رمز و تأیید مجدد هویت را با نقش واقعی محیط آزمون کنید. دسترسی تغییر ساختار یا حذف تاریخچه به نقش برنامه ندهید.

</details>

شماره مدیر را در `ADMIN_PHONE` تنظیم کنید، سرویس را بالا بیاورید و از صفحهٔ ورود با کد همان شماره وارد شوید:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web
```

این پیکربندی مبنای استقرار روی یک میزبان است. نسخهٔ دانشگاهی به بررسی دسترسی‌ها، امنیت، ظرفیت و پشتیبان‌گیری روی زیرساخت مقصد نیاز دارد.

## ۵. آزمون و بررسی سلامت

برای اولین اجرای آزمون‌ها، پایگاه جداگانه بسازید. اگر `niticket_test` وجود دارد، دستور `createdb` را تکرار نکنید.

```sh
docker compose exec -T postgres createdb -U niticket niticket_test
node --env-file=.env scripts/test-database.mjs
docker compose build worker
docker compose up -d --no-deps --wait --wait-timeout 120 worker
pnpm test
pnpm test:integration
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

روی ویندوز، در صورت وجود، Playwright از Edge نصب‌شده استفاده می‌کند. در محیط دیگر Chromium را با دستور بالا نصب کنید. نام کاربر پایگاه در دستور نمونه `niticket` است؛ اگر آن را تغییر داده‌اید، دستور را هماهنگ کنید. `TEST_DATABASE_URL` برای پایگاه آزمون دیگر قابل تنظیم است و نام آن باید به `_test` ختم شود.

```sh
docker compose ps
docker compose logs --tail=100 web worker
curl http://localhost:3000/api/health/live
curl http://localhost:3000/api/health/ready
```

آمادگی وب، اتصال PostgreSQL و Redis را بررسی می‌کند؛ آماده‌بودن S3، پیامک و ClamAV را جداگانه بسنجید. خروجی‌ها و traceهای آزمون در مسیرهای نادیده‌گرفته‌شدهٔ Git تولید می‌شوند و مستندات پروژه محسوب نمی‌شوند.

## ۶. به‌روزرسانی و پشتیبان‌گیری

پیش از مهاجرت، از پایگاه داده و نسخه‌های فایل‌ها پشتیبان هماهنگ بگیرید. تصویرها را از نسخهٔ بازبینی‌شده بسازید، مهاجرت را یک‌بار اجرا و سپس وب و worker را به‌روزرسانی کنید. `prisma migrate deploy` مهاجرت‌ها را برنمی‌گرداند؛ بازگشت برنامه فقط با بررسی سازگاری ساختار داده مجاز است.

نمونهٔ پشتیبان محلی PostgreSQL:

```sh
docker compose exec -T postgres pg_dump -U niticket -d niticket -Fc -f /tmp/niticket.dump
docker compose cp postgres:/tmp/niticket.dump ./niticket.dump
```

فایل خروجی خصوصی است: آن را رمزنگاری و خارج از پوشهٔ پروژه نگهداری کنید. روی PowerShell برای dump باینری از تغییر مسیر متنی خروجی استفاده نکنید. نسخه‌ها و فرادادهٔ S3 را هم پشتیبان بگیرید؛ پشتیبان پایگاه داده به‌تنهایی شامل فایل‌ها نیست.

بازیابی را ابتدا در پایگاه و مخزن جدا انجام دهید و شمار رکوردها، تریگر ممیزی و checksum فایل‌های نمونه را بررسی کنید. ابزارهای `verify-restore.ts`، `verify-bootstrap.ts` و `verify-audio.ts` برای بررسی‌های اختصاصی آزمون باقی مانده‌اند؛ ابزار بررسی ورود موبایلی فقط از پایگاه آزمون استفاده می‌کند.

## عیب‌یابی کوتاه

| نشانه                     | بررسی                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| ورود دانشجو انجام نمی‌شود | قالب موبایل، انقضای کد، محدودیت تلاش و لاگ رویداد sms.otp                      |
| فایل در حال بررسی مانده   | worker، آمادگی ClamAV، فضای S3 و نصب ffmpeg/ffprobe                            |
| درخواست `403` می‌گیرد     | نقش، نشست، `APP_ORIGIN` و نیاز مدیر به تأیید مجدد رمز                          |
| پاسخ `409` دیده می‌شود    | تازه‌سازی تیکت و تلاش با نسخهٔ جدید؛ حفظ کلید ثبت اولیه در تلاش مجدد           |
| ضبط صدا فعال نیست         | HTTPS یا localhost، مجوز میکروفون و پشتیبانی مرورگر                            |
| بیلد کمبود حافظه دارد     | ساخت ترتیبی وب و worker و آزادکردن حافظهٔ میزبان                               |
| Redis قطع است             | اتصال را بازیابی کنید؛ محدودکنندهٔ درخواست را دور نزنید، Outbox پایدار می‌ماند |

حذف volumeها، عمومی‌کردن مخزن فایل یا دورزدن قرنطینه راه‌حل عیب‌یابی نیست. نگهداری و حذف خودکار داده فقط پس از تعیین سیاست دانشگاه تنظیم شود.

## ارتقا از ورود ایمیلی

پیش از مهاجرت نسخهٔ موبایلی، از PostgreSQL نسخهٔ پشتیبان بگیرید. مهاجرت اطلاعات و گفتگوها را حفظ می‌کند، اعلان ایمیلی را غیرفعال و نشست‌های ورود قبلی را لغو می‌کند. فقط شماره‌های معتبر و یکتا به شناسهٔ موبایل منتقل می‌شوند. حساب‌های بدون شماره یا دارای شمارهٔ تکراری از مدیریت کاربران نیاز به اصلاح دارند. کد OTP هرگز از API برگردانده نمی‌شود؛ تا تکمیل پنل، در لاگ وب در دسترس توسعه‌دهنده است.
