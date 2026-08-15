# SOLO CHAT

Full-stack starter ya social chat yenye:
- Sign up / Login / persistent JWT session
- Free account
- Random matching
- Private real-time-ready chat
- Friends
- Rooms
- Notifications
- Profile/settings
- Free vs Premium
- HarakaPay payment integration
- Payment status + webhook
- Automatic premium activation/expiry data
- Admin dashboard

## 1. Requirements
- Node.js 20+
- PostgreSQL
- HarakaPay API key

## 2. Setup

```bash
npm install
```

Copy `.env.example` kuwa `.env`, kisha jaza:

```env
DATABASE_URL=...
JWT_SECRET=...
APP_URL=https://your-domain.com
HARAKAPAY_API_KEY=...
```

Run:

```bash
npm start
```

Fungua:
`http://localhost:3000`

## 3. Database
Server inajaribu ku-run `schema.sql` automatically wakati inaanza.

## 4. HarakaPay
Backend inatumia:
- POST `/api/v1/collect`
- GET `/api/v1/status/{order_id}`
- POST webhook kwenye `/api/payments/harakapay/webhook`

API key iko server-side tu.

Kabla ya production, linganisha request/response fields na documentation ya sasa ya HarakaPay na uweke webhook verification/signature kama account/API yao inaitaka.

## 5. Admin
Register user kawaida kwanza, kisha kwenye PostgreSQL badilisha role:

```sql
UPDATE users SET role='admin' WHERE email='your@email.com';
```

Kisha login kwenye main site, copy JWT kutoka browser localStorage key `solo_token`, na iweke kwenye `/admin.html`.

## 6. Important production notes
- Usipost `.env` GitHub.
- Tumia HTTPS.
- Tumia PostgreSQL ya production.
- Weka strong `JWT_SECRET`.
- Weka webhook authentication/signature verification kulingana na HarakaPay docs.
- Ongeza email verification, password reset, rate limiting, moderation, file storage, backups na logging kabla ya launch kubwa.
- `randomMatch()` ya frontend hapa ni starter/demo matching; kwa production matching inapaswa kuhamishiwa server-side/queue ili limits zisiweze kudanganywa.

## 7. Deploy
Kwa Render/Railway/VPS:
- Build: `npm install`
- Start: `npm start`
- Add environment variables
- Connect PostgreSQL
- Set `APP_URL` kuwa public HTTPS URL
- HarakaPay webhook URL itakuwa:
`APP_URL + /api/payments/harakapay/webhook`
