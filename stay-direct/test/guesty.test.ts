/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createQuote, getCalendar, getToken, GuestyError, listStays, resetForTests } from "../lib/guesty";
import { normalizeQuote, normalizeStay, quoteTotal } from "../lib/normalize";
import { resetStoreForTests } from "../lib/tokenStore";
import { fakeFetch, freshEnv, rawListing, restoreFetch, tokenOk } from "./helpers";

beforeEach(() => freshEnv());
afterEach(() => restoreFetch());

describe("token handling", () => {
  it("asks Guesty for a token once, however many requests run at the same time", async () => {
    const calls = fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { body: { results: [], pagination: {} } }));
    await Promise.all([listStays({ minOccupancy: 1 }), listStays({ minOccupancy: 2 }), listStays({ minOccupancy: 3 }), getCalendar("abc123", "2030-01-01", "2030-01-05")]);
    const tokenCalls = calls.filter((c) => c.url.pathname === "/oauth2/token");
    assert.equal(tokenCalls.length, 1);
    assert.deepEqual(tokenCalls[0].body, { grant_type: "client_credentials", scope: "booking_engine:api", client_id: "test-id", client_secret: "test-secret" });
    assert.equal(tokenCalls[0].headers["content-type"], "application/x-www-form-urlencoded");
  });

  it("sends the token as a bearer header", async () => {
    const calls = fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { body: { results: [], pagination: {} } }));
    await listStays({});
    const api = calls.find((c) => c.url.pathname === "/api/listings")!;
    assert.equal(api.headers.authorization, "Bearer tok-1");
  });

  it("shares the token between server instances through Upstash, so a cold start does not renew it", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "r-token";
    const redis = new Map<string, string>();
    let tokenRequests = 0;
    fakeFetch((c) => {
      if (c.url.host === "redis.test") {
        const [op, key, val, ...rest] = c.body as string[];
        if (op === "GET") return { body: { result: redis.get(key) ?? null } };
        if (op === "DEL") return { body: { result: redis.delete(key) ? 1 : 0 } };
        if (op === "SET") {
          if (rest.includes("NX") && redis.has(key)) return { body: { result: null } };
          redis.set(key, val);
          return { body: { result: "OK" } };
        }
      }
      if (c.url.pathname === "/oauth2/token") {
        tokenRequests++;
        return tokenOk;
      }
      return { body: { results: [], pagination: {} } };
    });
    await getToken();
    // Simulate a brand new serverless instance: memory is empty, Redis still has the token.
    resetForTests();
    resetStoreForTests();
    const t = await getToken();
    assert.equal(t, "tok-1");
    assert.equal(tokenRequests, 1);
  });

  it("gets a new token once and retries when Guesty says the token is no longer valid", async () => {
    let n = 0;
    let listingCalls = 0;
    const calls = fakeFetch((c) => {
      if (c.url.pathname === "/oauth2/token") return { body: { ...tokenOk.body, access_token: "tok-" + ++n } };
      listingCalls++;
      if (listingCalls === 1) return { status: 401, body: { error: { code: "UNAUTHORIZED", message: "expired" } } };
      return { body: { results: [rawListing("a1b2c3")], pagination: {} } };
    });
    const stays = await listStays({});
    assert.equal(stays.length, 1);
    assert.equal(calls.filter((c) => c.url.pathname === "/oauth2/token").length, 2);
    assert.equal(calls[calls.length - 1].headers.authorization, "Bearer tok-2");
  });

  it("explains a missing credential clearly", async () => {
    freshEnv();
    delete process.env.GUESTY_CLIENT_SECRET;
    await assert.rejects(listStays({}), (e: any) => e instanceof GuestyError && e.code === "config" && /GUESTY_CLIENT_SECRET/.test(e.message));
  });

  it("explains a rejected credential and a rate-limited token request", async () => {
    fakeFetch(() => ({ status: 401, body: { error: "invalid_client" } }));
    await assert.rejects(getToken(), (e: any) => /Guesty refused the credentials/.test(e.message));
    resetForTests();
    resetStoreForTests();
    fakeFetch(() => ({ status: 429, body: {} }));
    await assert.rejects(getToken(), (e: any) => e.status === 429 && /limiting new tokens/.test(e.message));
  });
});

describe("requests", () => {
  it("follows the cursor through every page of listings", async () => {
    const calls = fakeFetch((c) => {
      if (c.url.pathname === "/oauth2/token") return tokenOk;
      const cursor = c.url.searchParams.get("cursor");
      if (!cursor) return { body: { results: [rawListing("aaa111"), rawListing("bbb222")], pagination: { total: 3, cursor: { next: "page2" } } } };
      return { body: { results: [rawListing("ccc333")], pagination: { total: 3, cursor: {} } } };
    });
    const stays = await listStays({});
    assert.deepEqual(stays.map((s) => s.id), ["aaa111", "bbb222", "ccc333"]);
    assert.equal(calls.filter((c) => c.url.pathname === "/api/listings").length, 2);
    assert.equal(calls.find((c) => c.url.pathname === "/api/listings")!.url.searchParams.get("limit"), "100");
  });

  it("passes dates and guest count to the listings search", async () => {
    const calls = fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { body: { results: [], pagination: {} } }));
    await listStays({ checkIn: "2031-03-01", checkOut: "2031-03-04", minOccupancy: 4 });
    const q = calls.find((c) => c.url.pathname === "/api/listings")!.url.searchParams;
    assert.equal(q.get("checkIn"), "2031-03-01");
    assert.equal(q.get("checkOut"), "2031-03-04");
    assert.equal(q.get("minOccupancy"), "4");
  });

  it("waits and retries once when Guesty answers 429", async () => {
    let tries = 0;
    fakeFetch((c) => {
      if (c.url.pathname === "/oauth2/token") return tokenOk;
      tries++;
      return tries === 1 ? { status: 429, headers: { "retry-after": "0" }, body: {} } : { body: { results: [], pagination: {} } };
    });
    await listStays({});
    assert.equal(tries, 2);
  });

  it("serves the last good list if Guesty fails afterwards", async () => {
    let fail = false;
    fakeFetch((c) => {
      if (c.url.pathname === "/oauth2/token") return tokenOk;
      return fail ? { status: 500, body: {} } : { body: { results: [rawListing("keep01")], pagination: {} } };
    });
    await listStays({});
    fail = true;
    // Same options hit the cache, so this proves the cache; a different option proves the error surfaces.
    assert.equal((await listStays({})).length, 1);
    await assert.rejects(listStays({ minOccupancy: 9 }));
  });

  it("asks for a quote with Guesty's field names and reads the result", async () => {
    const calls = fakeFetch((c) => {
      if (c.url.pathname === "/oauth2/token") return tokenOk;
      return {
        body: {
          _id: "q123456",
          expiresAt: "2031-01-02T00:00:00Z",
          rates: { ratePlans: [{ _id: "rp1", name: "Standard", cancellationPolicy: "Flexible", money: { currency: "AUD", fareAccommodation: 1200, fareCleaning: 150, totalFees: 150, subTotalPrice: 1350, totalTaxes: 135, hostPayout: 1485 } }] },
        },
      };
    });
    const q = await createQuote({ listingId: "list01", checkIn: "2031-02-01", checkOut: "2031-02-04", guests: 3, coupon: "SAVE10" });
    const call = calls.find((c) => c.url.pathname === "/api/reservations/quotes")!;
    assert.equal(call.method, "POST");
    assert.deepEqual(call.body, { listingId: "list01", checkInDateLocalized: "2031-02-01", checkOutDateLocalized: "2031-02-04", guestsCount: 3, coupons: "SAVE10" });
    assert.equal(q.quoteId, "q123456");
    assert.equal(q.nights, 3);
    assert.equal(q.ratePlans[0].total, 1485);
    assert.equal(q.currency, "AUD");
    assert.deepEqual(q.ratePlans[0].items.map((i) => i.title), ["Accommodation", "Cleaning fee", "Taxes"]);
  });
});

describe("normalising Guesty data", () => {
  it("reads pets from guest controls, house rules or the amenity list", () => {
    assert.equal(normalizeStay(rawListing("a1", { publicDescription: { guestControls: { allowsPets: false } } })).pets, false);
    assert.equal(normalizeStay(rawListing("a2", { publicDescription: {}, unitTypeHouseRules: { houseRules: { petsAllowed: { enabled: true } } } })).pets, true);
    assert.equal(normalizeStay(rawListing("a3", { publicDescription: {}, amenities: ["Pets allowed"] })).pets, true);
    assert.equal(normalizeStay(rawListing("a4", { publicDescription: {}, amenities: [] })).pets, false);
  });

  it("picks the large photo and falls back gracefully", () => {
    const s = normalizeStay(rawListing("p1"));
    assert.equal(s.photos[0].url, "https://img.test/l.jpg");
    assert.equal(s.photos[0].thumb, "https://img.test/t.jpg");
    assert.equal(normalizeStay(rawListing("p2", { pictures: [] })).photos.length, 0);
  });

  it("copes with a listing that has almost nothing filled in", () => {
    const s = normalizeStay({ _id: "bare01" });
    assert.equal(s.title, "Holiday home");
    assert.equal(s.basePrice, 0);
    assert.equal(s.currency, "AUD");
    assert.deepEqual(s.sections, []);
  });

  it("uses the quote total from hostPayout, or sub total plus taxes", () => {
    assert.equal(quoteTotal({ hostPayout: 500, subTotalPrice: 1, totalTaxes: 1 }), 500);
    assert.equal(quoteTotal({ subTotalPrice: 400, totalTaxes: 40 }), 440);
  });

  it("prefers Guesty's invoice lines when present", () => {
    const q = normalizeQuote(
      { _id: "q1", rates: { ratePlans: [{ _id: "r", name: "Std", money: { currency: "AUD", hostPayout: 10, invoiceItems: [{ title: "3 nights", amount: 9 }, { title: "Zero", amount: 0 }, { normalType: "CF", amount: 1 }] } }] } },
      { checkIn: "2031-01-01", checkOut: "2031-01-04", nights: 3, guests: 2 },
    );
    assert.deepEqual(q.ratePlans[0].items, [{ title: "3 nights", amount: 9 }, { title: "CF", amount: 1 }]);
  });
});
