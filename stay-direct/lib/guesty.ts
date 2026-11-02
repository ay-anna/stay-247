/* eslint-disable @typescript-eslint/no-explicit-any */
import { isMock } from "./config";
import { eachNight } from "./format";
import * as mock from "./mock";
import { normalizeCalendar, normalizeQuote, normalizeStay } from "./normalize";
import { getStore } from "./tokenStore";
import type { CalendarDay, QuoteView, Stay } from "./types";

export class GuestyError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  retryAfter?: number;
  constructor(message: string, status: number, code?: string, requestId?: string, retryAfter?: number) {
    super(message);
    this.name = "GuestyError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = () => (process.env.GUESTY_BASE_URL || "https://booking.guesty.com").replace(/\/$/, "");

/* ---------- token ---------- */

let mem: { token: string; exp: number } | null = null;
let inflight: Promise<string> | null = null;

async function requestNewToken(): Promise<{ token: string; expiresIn: number }> {
  const id = process.env.GUESTY_CLIENT_ID;
  const secret = process.env.GUESTY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new GuestyError("Guesty credentials are missing. Set GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET.", 500, "config");
  }
  const res = await fetch(`${base()}/oauth2/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "booking_engine:api", client_id: id, client_secret: secret }),
    signal: AbortSignal.timeout(15000),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    const hint =
      res.status === 429
        ? "Guesty is limiting new tokens (only a few per day are allowed). Wait and try again, and make sure a shared token store is set up."
        : "Guesty refused the credentials. Check GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET.";
    throw new GuestyError(`${hint} (HTTP ${res.status})`, res.status === 429 ? 429 : 502, "token", undefined, retryAfter);
  }
  return { token: String(data.access_token), expiresIn: Number(data.expires_in) || 86400 };
}

export async function getToken(): Promise<string> {
  if (mem && mem.exp > Date.now()) return mem.token;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const store = getStore();
      const useStored = (raw: string | null): string | null => {
        if (!raw) return null;
        try {
          const o = JSON.parse(raw);
          if (o?.token && o.exp > Date.now() + 60000) {
            mem = { token: o.token, exp: o.exp };
            return o.token;
          }
        } catch {
          /* ignore a corrupt value and fetch a new token */
        }
        return null;
      };
      const first = useStored(await store.get());
      if (first) return first;
      for (let attempt = 0; attempt < 24; attempt++) {
        if (await store.lock()) {
          try {
            const again = useStored(await store.get());
            if (again) return again;
            const { token, expiresIn } = await requestNewToken();
            const ttl = Math.max(120, expiresIn - 900);
            const exp = Date.now() + ttl * 1000;
            await store.set(JSON.stringify({ token, exp }), ttl);
            mem = { token, exp };
            return token;
          } finally {
            await store.unlock();
          }
        }
        await sleep(500);
        const other = useStored(await store.get());
        if (other) return other;
      }
      throw new GuestyError("Timed out waiting for another request to fetch the Guesty token.", 503, "token_wait");
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function invalidateToken(bad: string): Promise<void> {
  if (mem?.token === bad) mem = null;
  try {
    const store = getStore();
    const raw = await store.get();
    if (raw && JSON.parse(raw)?.token === bad) await store.del();
  } catch {
    /* best effort */
  }
}

/* ---------- requests ---------- */

interface CallOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function call<T = any>(method: "GET" | "POST", path: string, opts: CallOptions = {}): Promise<T> {
  let authRetried = false;
  let rateRetries = 0;
  for (;;) {
    const token = await getToken();
    const url = new URL(`${base()}/api${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 && !authRetried) {
      authRetried = true;
      await invalidateToken(token);
      continue;
    }
    if (res.status === 429 && rateRetries < 2) {
      rateRetries++;
      const wait = Math.min(2, Number(res.headers.get("retry-after")) || 1);
      await sleep(wait * 1000);
      continue;
    }
    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error ?? {};
      throw new GuestyError(
        String(e.message ?? data?.message ?? `Guesty returned HTTP ${res.status}`),
        res.status,
        e.code ? String(e.code) : undefined,
        e.data?.requestId ? String(e.data.requestId) : undefined,
        Number(res.headers.get("retry-after")) || undefined,
      );
    }
    return data as T;
  }
}

/** Mock calls throw plain errors with a status; turn them into GuestyError so callers see one type. */
function mocked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e: any) {
    throw new GuestyError(e.message, e.status ?? 500);
  }
}

/* ---------- small cache, so busy pages do not use up Guesty's rate limit ---------- */

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (hit) return hit.value as T; // serve slightly old data rather than an error page
    throw e;
  }
}

export function resetForTests(): void {
  mem = null;
  inflight = null;
  cache.clear();
}

/* ---------- public API ---------- */

export interface ListOptions {
  checkIn?: string;
  checkOut?: string;
  minOccupancy?: number;
}

export async function listStays(opts: ListOptions = {}): Promise<Stay[]> {
  const dated = Boolean(opts.checkIn && opts.checkOut);
  return cached(`list:${JSON.stringify(opts)}`, dated ? 60_000 : 300_000, async () => {
    const raw: any[] = [];
    if (isMock()) {
      raw.push(...mock.listings({ ...opts }).results);
    } else {
      let cursor: string | undefined;
      for (let page = 0; page < 50; page++) {
        const data = await call<any>("GET", "/listings", {
          query: { limit: 100, cursor, checkIn: opts.checkIn, checkOut: opts.checkOut, minOccupancy: opts.minOccupancy },
        });
        const results: any[] = Array.isArray(data?.results) ? data.results : [];
        raw.push(...results);
        cursor = data?.pagination?.cursor?.next;
        if (!cursor || !results.length) break;
      }
    }
    return raw.map(normalizeStay);
  });
}

export async function getStay(id: string): Promise<Stay> {
  return cached(`stay:${id}`, 300_000, async () => {
    const data = isMock() ? mocked(() => mock.listing(id)) : await call<any>("GET", `/listings/${encodeURIComponent(id)}`);
    return normalizeStay(data?.results ?? data);
  });
}

export async function getCalendar(id: string, from: string, to: string): Promise<CalendarDay[]> {
  return cached(`cal:${id}:${from}:${to}`, 30_000, async () => {
    const data = isMock()
      ? mocked(() => mock.calendar(id, from, to))
      : await call<any>("GET", `/listings/${encodeURIComponent(id)}/calendar`, { query: { from, to } });
    return normalizeCalendar(data);
  });
}

export async function createQuote(input: { listingId: string; checkIn: string; checkOut: string; guests: number; coupon?: string }): Promise<QuoteView> {
  const nights = eachNight(input.checkIn, input.checkOut).length;
  const body: Record<string, unknown> = {
    listingId: input.listingId,
    checkInDateLocalized: input.checkIn,
    checkOutDateLocalized: input.checkOut,
    guestsCount: input.guests,
  };
  if (input.coupon) body.coupons = input.coupon;
  const raw = isMock() ? mocked(() => mock.createQuote(body)) : await call<any>("POST", "/reservations/quotes", { body });
  return normalizeQuote(raw, { checkIn: input.checkIn, checkOut: input.checkOut, nights, guests: input.guests });
}

export async function getPaymentProvider(listingId: string): Promise<any> {
  return cached(`pay:${listingId}`, 600_000, async () =>
    isMock() ? mock.paymentProvider(listingId) : call<any>("GET", `/listings/${encodeURIComponent(listingId)}/payment-provider`),
  );
}

export interface InstantChargeBody {
  ratePlanId: string;
  initialPaymentMethodId: string;
  guest: { firstName: string; lastName: string; email: string; phone?: string };
  policy?: unknown;
}

/** Charges the card first, and Guesty only creates the reservation if the charge works. */
export async function instantCharge(quoteId: string, body: InstantChargeBody): Promise<any> {
  if (isMock()) return mocked(() => mock.instantCharge(quoteId, body));
  return call<any>("POST", `/reservations/quotes/${encodeURIComponent(quoteId)}/instant-charge`, { body });
}

export async function verifyPayment(reservationId: string, body: { paymentId: string; threeDSResult?: unknown }): Promise<any> {
  if (isMock()) return { reservation: { _id: reservationId, status: "confirmed", confirmationCode: "DEMO3DS" }, payment: { status: "SUCCEEDED" } };
  return call<any>("POST", `/reservations/${encodeURIComponent(reservationId)}/verify-payment`, { body });
}
