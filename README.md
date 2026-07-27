# FORCE Arena

FORCE Arena adalah web application komunitas berbasis Next.js dan React yang menyediakan autentikasi member, duel kuis realtime berbasis polling, leaderboard, profil member, FORCE Go to Schools, dan FORCE Shops.

## Release notes

Release ini menggunakan arsitektur server-only untuk akses database:

- Next.js 15 dan React 19.
- Supabase PostgreSQL sebagai satu-satunya persistent source of truth.
- Supabase Service Role hanya digunakan di server API.
- Browser tidak menggunakan Supabase Anon Key dan tidak terhubung langsung ke database.
- Session hanya disimpan dalam HttpOnly cookie.
- Vercel sebagai deployment platform.
- n8n opsional untuk notifikasi order FORCE Shops.

Tidak ada Upstash Redis, Redis client, token session di `localStorage`, atau legacy direct-Supabase browser client.

## Fitur utama

### Authentication

- Registrasi dan login memakai username serta password.
- Session disimpan dalam cookie `HttpOnly`, `SameSite=Lax`, `Secure` di production, dan `Priority=High`.
- Masa session 30 hari.
- Session token dirotasi otomatis setelah berumur 7 hari.
- Satu active session per user.
- Request yang mengubah data wajib berasal dari Origin yang sama dengan aplikasi.
- Logout menghapus session database dan cookie browser.

### Duel

- Matchmaking, invitation duel, kategori, hasil, FP, win/loss/draw, dan streak.
- ID duel selalu diverifikasi terhadap user yang sedang login.
- Jawaban hanya dapat disimpan sekali.
- Urutan soal, waktu jawaban, kebenaran, dan poin dihitung di PostgreSQL melalui RPC atomic.
- Row duel dikunci selama submit jawaban untuk mencegah race condition.
- Browser tidak dipercaya untuk mengirim waktu, posisi, atau skor.
- Dashboard hanya menampilkan tujuh duel terbaru; duel lama tidak dihapus hanya karena tidak tampil.
- Duel selesai dan dibatalkan dibersihkan berdasarkan retention global 30 hari.

### FORCE Go to Schools

- Invitation code event.
- Satu attempt per akun untuk satu event.
- Jawaban, waktu, poin, konversi FP, dan penyelesaian attempt diproses melalui RPC PostgreSQL.
- Attempt dan answer sementara memiliki retention dua hari.
- Cleanup dijalankan melalui `pg_cron` bila tersedia dan melalui fallback maintenance API.

### FORCE Shops

- Katalog produk dan stok di Supabase.
- Spendable Force Points terpisah dari Lifetime FP.
- Redeem produk dilakukan melalui RPC transaction atomic.
- Saldo, stok, order, item, dan ledger berubah bersama atau seluruh transaksi dibatalkan.
- n8n bersifat opsional dan bukan source of truth.

## Struktur project

```text
forceReact/
├── app/
│   ├── globals.css
│   ├── layout.jsx
│   ├── page.jsx
│   └── styles/
├── components/
│   ├── ForceApp.jsx
│   ├── ForceDuelEnhancer.jsx
│   └── ForceFeaturePages.jsx
├── pages/
│   └── api/
│       ├── [...path].js
│       └── data.js
├── public/
│   ├── gif/
│   ├── image/
│   ├── shop/
│   ├── sounds/
│   ├── svg/
│   ├── manifest.webmanifest
│   └── sw.js
├── scripts/
│   └── check-static.mjs
├── supabase/
│   ├── schema.sql
│   └── migrations/
│       └── 20260717_security_hardening.sql
├── .env.example
├── next.config.js
├── package.json
├── package-lock.json
├── vercel.json
└── README.md
```

## Environment variables

### Wajib

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WORKER_SECRET=use-a-long-random-secret
```

`SUPABASE_SERVICE_ROLE_KEY` tidak boleh diberi prefix `NEXT_PUBLIC_` dan tidak boleh dimasukkan ke browser, repository, screenshot, atau client-side code.

`SUPABASE_ANON_KEY` tidak diperlukan.

### Admin reset

```env
ADMIN_RESET_KEY=use-a-long-random-secret
ADMIN_USERS=admin_username
```

### Email reset opsional

```env
RESEND_API_KEY=re_xxxxxxxxx
RESET_FROM_EMAIL=FORCE <noreply@your-domain.com>
RESET_REPLY_TO_EMAIL=admin@your-domain.com
```

### n8n Shops opsional

```env
N8N_SHOP_WEBHOOK_URL=https://your-n8n-domain.com/webhook/force-shop-order
N8N_SHOP_WEBHOOK_SECRET=use-a-long-random-secret
```

## Menyiapkan database baru

Gunakan prosedur ini hanya untuk project Supabase kosong:

1. Buat project Supabase.
2. Buka SQL Editor.
3. Jalankan seluruh isi `supabase/schema.sql` satu kali.
4. Pastikan tidak ada error.
5. Jangan menjalankan migration active-database setelah schema fresh-install berhasil.

`schema.sql` sudah memuat seluruh tabel, index, trigger, RPC, retention, seed yang dibutuhkan, RLS, dan database privilege server-only.

## Mengamankan database FORCE yang sudah aktif

Jangan menjalankan `schema.sql` pada database production yang sudah berisi data.

Urutan aman:

1. Buat backup Supabase atau point-in-time recovery bila tersedia.
2. Buka SQL Editor.
3. Jalankan `supabase/migrations/20260717_security_hardening.sql`.
4. Jalankan verification queries yang tersedia di bagian bawah migration.
5. Pastikan `anon_schema_usage = false`.
6. Pastikan `anon_can_submit_duel = false`.
7. Pastikan `service_role_can_submit_duel = true`.
8. Setelah migration sukses, deploy code release ini.

Migration tersebut:

- Menambahkan kolom poin jawaban duel.
- Melakukan backfill poin untuk jawaban lama.
- Membuat RPC atomic `force_submit_duel_answer`.
- Menolak duplicate answer dan urutan soal yang salah.
- Menghitung waktu serta poin di server database.
- Mencabut seluruh akses schema, table, sequence, dan function dari `PUBLIC`, `anon`, dan `authenticated`.
- Memberikan akses aplikasi kepada `service_role`.
- Mengatur default privileges agar object database baru tidak otomatis menjadi public.

Migration tidak menghapus user, wallet, produk, order, atau riwayat duel.

## Instalasi lokal

Persyaratan:

```text
Node.js 20.x
npm 10.x
```

Jalankan:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Buka:

```text
http://localhost:3000
```

Request POST/PATCH/PUT/DELETE harus berasal dari origin aplikasi yang sama. Gunakan aplikasi melalui alamat Next.js, bukan membuka file HTML langsung.

## Build dan pemeriksaan

```bash
npm run check:static
npm run check:security
npm audit
npm run build
npm start
```

Jangan deploy bila static check atau production build gagal.

## Deploy ke Vercel

1. Simpan repository sebagai private repository.
2. Import repository ke Vercel.
3. Pilih Node.js 20.x.
4. Tambahkan environment variables wajib.
5. Pastikan `SUPABASE_ANON_KEY` tidak ada.
6. Pastikan `WORKER_SECRET` terisi secret panjang dan acak.
7. Deploy production.
8. Buka `/api/health`; response hanya boleh menampilkan status layanan umum tanpa status secret atau konfigurasi internal.
9. Uji login, logout, rotasi cookie, duel, school attempt, redeem shop, dan worker.

### Worker endpoint

```text
POST /api/worker/drain
```

Wajib menggunakan header:

```text
x-worker-secret: <WORKER_SECRET>
```

Ketentuan:

- GET ditolak.
- Query-string secret tidak diterima.
- Bearer token tidak diterima.
- Endpoint menolak request bila `WORKER_SECRET` belum dikonfigurasi.

## Security headers

`next.config.js` mengaktifkan:

- Content-Security-Policy.
- Strict-Transport-Security.
- X-Content-Type-Options.
- Referrer-Policy.
- Permissions-Policy.
- `frame-ancestors 'none'` dan `X-Frame-Options: DENY`.
- Cross-Origin-Opener-Policy.
- Penghapusan header `X-Powered-By`.

Setelah deploy, cek response headers dari halaman utama dan endpoint API.

## Model keamanan database

Seluruh request aplikasi mengikuti alur:

```text
Browser
→ Next.js API
→ Session cookie validation
→ Authorization check
→ Supabase Service Role server client
→ PostgreSQL/RPC
```

Browser tidak memiliki permission langsung ke schema `public`. RLS tetap aktif sebagai defense-in-depth, tetapi kontrol utama berada di server API dan RPC PostgreSQL.

Mengganti angka atau ID pada URL tidak cukup untuk membuka data user lain karena endpoint privat memverifikasi user session dan ownership/participant relation sebelum mengembalikan data.

## Data retention

| Data | Retention / cleanup |
|---|---|
| Session | Expire 30 hari; session lama dibersihkan otomatis |
| Password reset code | Expire 15 menit; data expired dibersihkan |
| Duel invitation | Expire sekitar 30 detik |
| Matchmaking queue | Entry stale/cancelled dibersihkan |
| Duel answer detail | Temporary cleanup sekitar dua hari sesuai maintenance schema |
| Duel summary finished/cancelled | 30 hari |
| School attempt dan answer | Dua hari setelah aktivitas/expiry |
| Shop order dan wallet ledger | Permanen sampai kebijakan bisnis menghapusnya |
| User/profile/FP | Permanen |

Foreign-key cascade digunakan agar child rows sementara ikut terhapus tanpa meninggalkan orphan data.

## Production checklist

- Migration database aktif berhasil.
- Verification privilege menghasilkan nilai yang benar.
- Service-role key hanya berada di server environment.
- Tidak ada `SUPABASE_ANON_KEY`.
- Tidak ada token session di `localStorage` atau `sessionStorage`.
- Cookie login memiliki `HttpOnly`, `Secure`, `SameSite=Lax`, dan `Priority=High`.
- `/api/realtime-config` mengembalikan 404.
- `/api/worker/drain` menolak GET dan secret yang salah.
- Duplicate duel answer menghasilkan HTTP 409.
- Urutan soal yang dimanipulasi ditolak.
- Dashboard hanya menampilkan tujuh duel tanpa menghapus riwayat database yang lebih lama.
- Security headers muncul pada deployment production.
- `npm run check:static`, `npm run check:security`, `npm audit`, dan `npm run build` berhasil.
