/* eslint-disable @typescript-eslint/no-explicit-any */
import { resetForTests } from "../lib/guesty";
import { resetStoreForTests } from "../lib/tokenStore";

export interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: any;
}

type Handler = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | Promise<{ status?: number; body?: unknown; headers?: Record<string, string> }>;

const realFetch = globalThis.fetch;

/** Replaces fetch with a fake. Returns the list of calls it saw. */
export function fakeFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((v, k) => (headers[k] = v));
    let body: any = init.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep as string */
      }
    } else if (body instanceof URLSearchParams) {
      body = Object.fromEntries(body.entries());
    }
    const call: Call = { method: init.method ?? "GET", url, headers, body };
    calls.push(call);
    const out = await handler(call);
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
  }) as typeof fetch;
  return calls;
}

export function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

export function freshEnv(extra: Record<string, string> = {}): void {
  for (const k of Object.keys(process.env)) {
    if (/^(GUESTY_|UPSTASH_|KV_|SITE_)/.test(k)) delete process.env[k];
  }
  process.env.GUESTY_CLIENT_ID = "test-id";
  process.env.GUESTY_CLIENT_SECRET = "test-secret";
  Object.assign(process.env, extra);
  resetForTests();
  resetStoreForTests();
}

export const tokenOk = { body: { token_type: "Bearer", expires_in: 86400, access_token: "tok-1", scope: "booking_engine:api" } };

export const rawListing = (id: string, over: any = {}) => ({
  _id: id,
  title: "Test House " + id,
  accommodates: 6,
  bedrooms: 3,
  bathrooms: 2,
  beds: 4,
  address: { city: "Leura", state: "NSW", full: "Leura NSW" },
  pictures: [{ original: "https://img.test/o.jpg", large: "https://img.test/l.jpg", thumbnail: "https://img.test/t.jpg" }],
  amenities: ["Wifi"],
  prices: { basePrice: 400, currency: "AUD" },
  publicDescription: { summary: "Nice place", guestControls: { allowsPets: true } },
  ...over,
});
