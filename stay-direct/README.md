# Stay Direct

A direct-booking website for your holiday rentals. It reads your properties, photos, availability and prices live from **Guesty**, and takes instant bookings with card payment through **GuestyPay**. Bookings land in Guesty like any other channel (Airbnb, Booking.com, etc.), so your calendar stays in sync.

No database and no framework. It runs as a handful of serverless functions on Vercel.

## Try it first (2 minutes, no Guesty needed)

```
npm install
npm run dev
```

Open http://localhost:3111. With no Guesty credentials it shows five pretend properties and a demo checkout (card `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined). Nothing is charged.

`npm test` runs the automated tests (38 checks against a simulated Guesty).

## Step 1: Set up Guesty

1. In Guesty, open **Distribution > Booking Engine API** (name may vary slightly by plan) and make sure the Booking Engine API is enabled for your account. If you cannot see it, ask Guesty support to enable "Booking Engine API".
2. Create an **API instance** for this website. Choose which listings it should show.
3. Set the booking option on the instance to **instant booking** (not "reservation request"). Instant booking is what lets guests pay straight away.
4. Copy the **Client ID** and **Client Secret**.
5. New API instances often need activating: Guesty may ask you to make one manual test booking and request one quote through the API before the instance goes live. `npm run check:guesty` (below) tells you if reads fail with a 401/403.
6. Make sure each listing you want shown has photos, a base price, and a payment method (GuestyPay) set up in Guesty.

## Step 2: Check the connection

Create a file named `.env` in the project folder (copy `env.example`, which is named without a dot, and fill in the two Guesty values). Then:

```
npm run check:guesty
```

It only **reads**: it gets a token, lists your properties, reads one calendar and the payment provider. It never books anything. Fix anything marked FAIL or CHECK before going further.

## Step 3: Deploy to Vercel

1. Put this folder in a GitHub repository (do **not** commit `.env`).
2. In Vercel, **Add New > Project**, import the repository. Leave the framework as "Other".
3. Add environment variables (Project > Settings > Environment Variables):
   - `GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET` (required)
   - `SITE_NAME`, `SITE_HEADLINE`, `SITE_TAGLINE`, `SITE_PHONE`, `SITE_EMAIL`, `SITE_URL` (your public address, used in the sitemap), `SITE_TIMEZONE` (default Australia/Sydney), `SITE_LOCALE` (default en-AU), `SITE_TERMS_URL`, `SITE_PRIVACY_URL`
4. **Add a shared token store** (important). Guesty only allows a few new access tokens per day, and serverless functions start cold often. In Vercel, open **Storage / Marketplace**, add **Upstash Redis** and connect it to the project. This sets the `UPSTASH_REDIS_REST_*` (or `KV_REST_API_*`) variables automatically. Without it you may be locked out by Guesty's token limit under traffic.
5. Deploy. Then add your domain under Project > Settings > Domains.

## Go-live checklist

- [ ] `npm run check:guesty` shows all OK against your real account.
- [ ] Make **one real test booking with a real card**, then cancel/refund it in Guesty. GuestyPay has no test mode, so this is the only way to prove the payment path.
- [ ] Compare the quote total on the site with the same dates in the Guesty dashboard. They should match.
- [ ] Confirm the booking appears in Guesty with the right guest, dates and payment, and that the dates then block on Airbnb/Booking.com.
- [ ] Try a card that needs 3-D Secure if you can (the challenge opens in a pop-up and the booking completes after).
- [ ] Set `SITE_TERMS_URL` and `SITE_PRIVACY_URL`; the checkout requires guests to accept the terms.
- [ ] Set `SITE_URL`, then submit `/sitemap.xml` to Google Search Console.

## What was and was not verified

Built and tested against a **simulated** Guesty, because the build environment cannot reach Guesty. The Guesty field names and request shapes come from Guesty's public Booking Engine API docs, but have **not been run against your account**. The first real run is where small differences (a field name, a missing price) would show up; the check script and test booking are designed to catch them.

Also known:
- **Stripe-based listings are not supported.** Only GuestyPay checkout is built. A listing on Stripe shows "contact us to book" instead of a card form.
- Guesty documents its rate limits inconsistently; the site caches listings (5 min), calendars (30 s) and retries once on 429.
- The Vercel runtime itself was not exercised here; the functions are plain Node handlers and are tested through the same route code.

## How it is built

- `api/*.ts` Vercel functions, each a thin wrapper around `lib/routes.ts`.
- `lib/guesty.ts` Guesty client (token handling, caching, retries). `lib/normalize.ts` turns Guesty data into the site's own shape. `lib/mock.ts` is the simulated Guesty.
- `lib/render.ts` builds the HTML pages on the server (fast, good for search engines). `public/booking.js` runs the calendar, quote and payment in the browser.
- Guests' card details never touch your server: they go straight from the browser to GuestyPay, which returns a one-time token.

## Changing the look

Edit `public/styles.css` (colours are variables at the top) and the text variables above. The placeholder artwork shown when a listing has no photo is generated in `lib/render.ts`.
