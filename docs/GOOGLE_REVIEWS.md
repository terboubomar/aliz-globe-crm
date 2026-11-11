# Google reviews

There are two ways to bring Google reviews into the CRM. They can run side by side.

## 1. Read-only ratings (Places API), works today

- Secret: `GOOGLE_PLACES_API_KEY` (Google Cloud → APIs & Services → Credentials →
  API key, with **Places API (New)** enabled, billing on, and the key restricted to
  that API).
- Settings → التكاملات → تقييمات Google → «ربط الفروع بخرائط Google»: search each
  branch and pick its place once. Only the place id is stored (`branches.google_place_id`).
- «تقييمات Google» page: each linked branch's average rating, number of ratings and
  the 5 most relevant reviews Google returns, read live (kept 30 minutes in server
  memory; review content is not stored, per Google's terms). Replies are made in
  Google Maps through the link on each review.
- Code: `src/functions/places.server.ts`, `src/functions/places.functions.ts`,
  `src/aliz/places-reviews.tsx`.

## 2. Full version (Business Profile API), needs Google's approval

- Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Callback:
  `https://alizglobecrm.lovable.app/api/public/google/callback` (or `PUBLIC_APP_ORIGIN`).
- Google must approve Business Profile API access for the Cloud project (days to weeks).
- Then: «ربط حساب Google», link branches to locations, and set star rules. All reviews
  are fetched every few minutes; low-star reviews become complaints and are answered
  by script or AI draft, sent at once or after staff approval.
- Code: `src/functions/google.server.ts`, `src/aliz/google-reviews.tsx`.
