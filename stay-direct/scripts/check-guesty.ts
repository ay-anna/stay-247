/**
 * Checks the Guesty connection. Run with: npm run check:guesty
 * Reads GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET from the environment or a .env file.
 * It only reads data: it lists your properties and one property's payment setup. It never books anything.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCalendar, getPaymentProvider, getToken, listStays } from "../lib/guesty";
import { addDays, todayISO } from "../lib/format";
import { usingSharedStore } from "../lib/tokenStore";

const envFile = join(__dirname, "..", ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const ok = (m: string) => console.log(`  OK    ${m}`);
const warn = (m: string) => console.log(`  CHECK ${m}`);
const bad = (m: string) => console.log(`  FAIL  ${m}`);

async function main() {
  console.log("\nGuesty connection check\n");
  if (process.env.GUESTY_MOCK === "1") warn("GUESTY_MOCK is set, so this will use pretend data. Unset it to test the real connection.");
  if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) {
    bad("GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET are not set.");
    process.exit(1);
  }
  if (usingSharedStore()) ok("A shared token store is configured (good for Vercel).");
  else warn("No shared token store is configured. Fine for this test. On Vercel you need one (see README), because Guesty limits token renewals.");

  try {
    await getToken();
    ok("Guesty accepted your credentials and issued a token.");
  } catch (e: any) {
    bad(e.message);
    process.exit(1);
  }

  try {
    const stays = await listStays({});
    if (!stays.length) {
      warn("Connected, but Guesty returned no properties. Check that your Booking Engine instance includes listings.");
      return;
    }
    ok(`Found ${stays.length} ${stays.length === 1 ? "property" : "properties"}:`);
    for (const s of stays.slice(0, 10)) {
      console.log(`          - ${s.title} (${s.city || "no city"}), sleeps ${s.sleeps}, ${s.photos.length} photos, from ${s.currency} ${s.basePrice}`);
      if (!s.photos.length) warn(`"${s.title}" has no photos in Guesty, so a placeholder will show.`);
      if (!s.basePrice) warn(`"${s.title}" has no base price in Guesty.`);
    }
    const first = stays[0];
    const today = todayISO();
    const days = await getCalendar(first.id, today, addDays(today, 60));
    ok(`Calendar for "${first.title}" returned ${days.length} days (${days.filter((d) => d.status === "available").length} available in the next 60).`);
    try {
      const p = await getPaymentProvider(first.id);
      ok(`Payment provider: ${p?.providerType ?? "unknown"} (${p?.paymentProcessorName ?? p?.accountName ?? "unnamed"}), status ${p?.status ?? "unknown"}.`);
      if (String(p?.providerType ?? "").toLowerCase().includes("stripe")) warn("This listing uses Stripe. This site's checkout supports GuestyPay only, so card payment will show as unavailable.");
    } catch (e: any) {
      warn(`Could not read the payment provider: ${e.message}`);
    }
    console.log("\nAll reads worked. Next, make a test booking by following the README's go-live checklist.\n");
  } catch (e: any) {
    bad(e.message + (e.requestId ? ` (Guesty request id ${e.requestId})` : ""));
    if (e.status === 401 || e.status === 403) console.log("          The credentials work but this API instance may not be activated. See the README, step 4.");
    process.exit(1);
  }
}

main();
