/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { addDays, todayISO } from "../lib/format";
import * as routes from "../lib/routes";
import { filterAvailable, nightlyFrom, parseSearch, searchStays } from "../lib/search";
import { normalizeStay } from "../lib/normalize";
import { fakeFetch, freshEnv, rawListing, restoreFetch, tokenOk } from "./helpers";

beforeEach(() => freshEnv());
afterEach(() => restoreFetch());

const today = todayISO();
const in30 = addDays(today, 30);
const in33 = addDays(today, 33);
const ctx = (over: any = {}) => ({ method: "GET", path: "/", query: {}, body: undefined, ...over });
const json = (r: { body: string }) => JSON.parse(r.body);

describe("search", () => {
  const stays = [
    normalizeStay(rawListing("aaa111", { title: "Zeta Lodge", accommodates: 10, bedrooms: 5, prices: { basePrice: 900, currency: "AUD" }, address: { city: "Katoomba" } })),
    normalizeStay(rawListing("bbb222", { title: "Alpha Cottage", accommodates: 4, bedrooms: 2, prices: { basePrice: 300, currency: "AUD" }, address: { city: "Leura" }, publicDescription: { guestControls: { allowsPets: false } }, amenities: ["Hot tub"] })),
    normalizeStay(rawListing("ccc333", { title: "Mid House", accommodates: 6, bedrooms: 3, prices: { basePrice: 500, currency: "AUD" }, address: { city: "Leura" } })),
  ];

  it("filters by place, guests, bedrooms, pets and keyword", () => {
    assert.deepEqual(searchStays(stays, { city: "leura" }).items.map((s) => s.id), ["bbb222", "ccc333"]);
    assert.deepEqual(searchStays(stays, { guests: 8 }).items.map((s) => s.id), ["aaa111"]);
    assert.deepEqual(searchStays(stays, { beds: 3 }).items.map((s) => s.id), ["aaa111", "ccc333"]);
    assert.deepEqual(searchStays(stays, { pets: true }).items.map((s) => s.id), ["aaa111", "ccc333"]);
    assert.deepEqual(searchStays(stays, { q: "hot tub" }).items.map((s) => s.id), ["bbb222"]);
  });

  it("sorts by price and name", () => {
    assert.deepEqual(searchStays(stays, { sort: "price" }).items.map((s) => s.id), ["bbb222", "ccc333", "aaa111"]);
    assert.deepEqual(searchStays(stays, { sort: "price-d" }).items.map((s) => s.id), ["aaa111", "ccc333", "bbb222"]);
    assert.deepEqual(searchStays(stays, { sort: "name" }).items.map((s) => s.title), ["Alpha Cottage", "Mid House", "Zeta Lodge"]);
  });

  it("pages results twelve at a time", () => {
    const many = Array.from({ length: 30 }, (_, i) => normalizeStay(rawListing("id" + String(i).padStart(4, "0"))));
    const r = searchStays(many, { page: 3 });
    assert.equal(r.items.length, 6);
    assert.equal(r.pages, 3);
    assert.equal(r.from, 25);
    assert.equal(r.to, 30);
    assert.equal(searchStays(many, { page: 99 }).page, 3);
  });

  it("ignores bad search input instead of trusting it", () => {
    const p = parseSearch({ checkIn: "nonsense", checkOut: "2030-01-01", guests: "-4", beds: "abc", sort: "drop table", page: "0" }, today);
    assert.equal(p.checkIn, undefined);
    assert.equal(p.guests, undefined);
    assert.equal(p.beds, undefined);
    assert.equal(p.sort, undefined);
    assert.equal(p.page, 1);
    assert.equal(parseSearch({ checkIn: addDays(today, -3), checkOut: in30 }, today).checkIn, undefined);
    assert.equal(parseSearch({ checkIn: in33, checkOut: in30 }, today).checkIn, undefined);
    assert.equal(parseSearch({ checkIn: in30, checkOut: in33 }, today).checkOut, in33);
  });

  it("drops stays with a fully booked night and prices the searched dates", () => {
    const d = (n: number) => addDays(in30, n);
    const a = normalizeStay(rawListing("av1111", { allotment: { [d(0)]: 1, [d(1)]: 1, [d(2)]: 1 }, nightlyRates: { [d(0)]: 400, [d(1)]: 500, [d(2)]: 600 } }));
    const b = normalizeStay(rawListing("av2222", { allotment: { [d(0)]: 1, [d(1)]: 0, [d(2)]: 1 } }));
    const c = normalizeStay(rawListing("av3333"));
    assert.deepEqual(filterAvailable([a, b, c], d(0), d(3)).map((s) => s.id), ["av1111", "av3333"]);
    assert.deepEqual(nightlyFrom(a, d(0), d(3)), { amount: 500, forDates: true });
    assert.deepEqual(nightlyFrom(c, d(0), d(3)), { amount: 400, forDates: false });
  });
});

describe("pages", () => {
  const serve = (listings: any[]) =>
    fakeFetch((c) => {
      if (c.url.pathname === "/oauth2/token") return tokenOk;
      if (c.url.pathname === "/api/listings") return { body: { results: listings, pagination: {} } };
      const one = listings.find((l) => c.url.pathname === `/api/listings/${l._id}`);
      if (one) return { body: { results: one } };
      return { status: 404, body: { error: { message: "Listing not found" } } };
    });

  it("renders the list with a card for each property", async () => {
    serve([rawListing("aaa111", { title: "Alpha" }), rawListing("bbb222", { title: "Beta" })]);
    const r = await routes.home(ctx());
    assert.equal(r.status, 200);
    assert.match(r.body, /Showing 1-2 of 2 properties/);
    assert.match(r.body, /href="\/stays\/aaa111"/);
    assert.match(r.headers["cache-control"], /s-maxage/);
  });

  it("escapes text that comes from Guesty", async () => {
    serve([rawListing("xss111", { title: '<script>alert(1)</script>', publicDescription: { summary: '"><img src=x onerror=alert(1)>' } })]);
    const home = (await routes.home(ctx())).body;
    const detail = (await routes.stay(ctx({ query: { id: "xss111" } }))).body;
    for (const html of [home, detail]) {
      assert.ok(!html.includes("<script>alert(1)</script>"));
      assert.ok(!html.includes('"><img src=x'));
    }
  });

  it("shows a friendly message when Guesty is down, and does not cache it", async () => {
    fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { status: 500, body: {} }));
    const r = await routes.home(ctx());
    assert.equal(r.status, 503);
    assert.match(r.body, /We could not load the stays/);
    assert.equal(r.headers["cache-control"], "no-store");
  });

  it("returns 404 for an unknown property and for a malformed id", async () => {
    serve([rawListing("aaa111")]);
    assert.equal((await routes.stay(ctx({ query: { id: "nope999" } }))).status, 404);
    assert.equal((await routes.stay(ctx({ query: { id: "../../etc" } }))).status, 404);
  });

  it("passes the searched dates to the property page", async () => {
    serve([rawListing("aaa111")]);
    const r = await routes.stay(ctx({ query: { id: "aaa111", checkIn: in30, checkOut: in33, guests: "4" } }));
    const data = JSON.parse(/<script type="application\/json" id="stay-data">(.*?)<\/script>/s.exec(r.body)![1]);
    assert.deepEqual(data.prefill, { checkIn: in30, checkOut: in33, guests: 4 });
  });

  it("lists properties in the sitemap", async () => {
    serve([rawListing("aaa111"), rawListing("bbb222")]);
    process.env.SITE_URL = "https://stays.example.com";
    const r = await routes.sitemap(ctx());
    assert.match(r.body, /<loc>https:\/\/stays\.example\.com\/stays\/aaa111<\/loc>/);
  });
});

describe("quote endpoint", () => {
  const post = (body: unknown) => routes.quote(ctx({ method: "POST", body }));
  const good = { listingId: "list01", checkIn: in30, checkOut: in33, guests: 2 };

  it("rejects bad input before calling Guesty", async () => {
    const calls = fakeFetch(() => ({ body: {} }));
    assert.equal((await routes.quote(ctx({ method: "GET" }))).status, 405);
    assert.equal((await post({ ...good, listingId: "../x" })).status, 400);
    assert.equal((await post({ ...good, checkIn: addDays(today, -1) })).status, 400);
    assert.equal((await post({ ...good, checkOut: good.checkIn })).status, 400);
    assert.equal((await post({ ...good, guests: 0 })).status, 400);
    assert.equal((await post({ ...good, coupon: "no spaces allowed!" })).status, 400);
    assert.equal(calls.length, 0);
  });

  it("returns a quote and never exposes the host payout field", async () => {
    fakeFetch((c) =>
      c.url.pathname === "/oauth2/token"
        ? tokenOk
        : { body: { _id: "q1", rates: { ratePlans: [{ _id: "rp1", name: "Std", money: { currency: "AUD", fareAccommodation: 900, subTotalPrice: 900, totalTaxes: 90, hostPayout: 990 } }] } } },
    );
    const r = await post(good);
    assert.equal(r.status, 200);
    assert.equal(json(r).ratePlans[0].total, 990);
    assert.ok(!r.body.includes("hostPayout"));
  });

  it("passes Guesty's 'not available' message to the guest", async () => {
    fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { status: 400, body: { error: { code: "BAD", message: "Listing is not available for the selected dates" } } }));
    const r = await post(good);
    assert.equal(r.status, 400);
    assert.match(json(r).error.message, /not available/);
  });
});

describe("booking endpoints", () => {
  const guest = { firstName: "Sam", lastName: "Lee", email: "sam@example.com", phone: "0400 000 000" };
  const body = { quoteId: "quote123", ratePlanId: "rate123", paymentMethodId: "pm_abc123", guest, acceptedTerms: true };
  const post = (b: unknown) => routes.book(ctx({ method: "POST", body: b }));

  it("charges through Guesty's instant-charge endpoint with the payment method id", async () => {
    const calls = fakeFetch((c) =>
      c.url.pathname === "/oauth2/token" ? tokenOk : { body: { reservation: { _id: "res1", status: "confirmed", confirmationCode: "ABC123" }, payment: { _id: "pay1", status: "SUCCEEDED" } } },
    );
    const r = await post(body);
    assert.equal(r.status, 200);
    assert.deepEqual(json(r), { status: "confirmed", confirmationCode: "ABC123", reservationId: "res1" });
    const call = calls.find((c) => c.url.pathname === "/api/reservations/quotes/quote123/instant-charge")!;
    assert.equal(call.method, "POST");
    assert.equal(call.body.ratePlanId, "rate123");
    assert.equal(call.body.initialPaymentMethodId, "pm_abc123");
    assert.deepEqual(call.body.guest, guest);
    assert.equal(call.body.policy.termsAndConditions.isAccepted, true);
  });

  it("asks the browser to complete 3-D Secure when Guesty requires it", async () => {
    fakeFetch((c) =>
      c.url.pathname === "/oauth2/token" ? tokenOk : { body: { reservation: { _id: "res1", status: "reserved" }, payment: { _id: "pay1", status: "PENDING_AUTH" }, threeDSChallenge: { opaque: "x" } } },
    );
    const r = await post(body);
    assert.deepEqual(json(r), { status: "needs_3ds", threeDSChallenge: { opaque: "x" }, paymentId: "pay1", reservationId: "res1" });
  });

  it("verifies a 3-D Secure payment and confirms", async () => {
    const calls = fakeFetch((c) =>
      c.url.pathname === "/oauth2/token" ? tokenOk : { body: { reservation: { _id: "res1", status: "confirmed", confirmationCode: "ZZZ999" }, payment: { _id: "pay1", status: "SUCCEEDED" } } },
    );
    const r = await routes.verify(ctx({ method: "POST", body: { reservationId: "res1", paymentId: "pay1", threeDSResult: { provider: "x", clientSideChallengeResultToken: "t" } } }));
    assert.equal(json(r).status, "confirmed");
    const call = calls.find((c) => c.url.pathname === "/api/reservations/res1/verify-payment")!;
    assert.equal(call.body.paymentId, "pay1");
    assert.equal(call.body.threeDSResult.provider, "x");
  });

  it("does not confirm when the payment failed, even if Guesty answers 200", async () => {
    fakeFetch((c) =>
      c.url.pathname === "/oauth2/token" ? tokenOk : { body: { reservation: { _id: "res1", status: "canceled" }, payment: { status: "FAILED", error: "Your card was declined" } } },
    );
    const r = await post(body);
    assert.equal(r.status, 402);
    assert.equal(json(r).error.message, "Your card was declined");
    assert.equal(json(r).error.code, "payment_failed");
  });

  it("does not confirm an unconfirmed reservation that carries no error", async () => {
    fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { body: { reservation: { _id: "res1", status: "reserved" }, payment: { status: "SUCCEEDED" } } }));
    assert.equal((await post(body)).status, 402);
  });

  it("requires accepted terms, a valid email and a payment method", async () => {
    const calls = fakeFetch(() => ({ body: {} }));
    assert.equal((await post({ ...body, acceptedTerms: false })).status, 400);
    assert.equal((await post({ ...body, guest: { ...guest, email: "nope" } })).status, 400);
    assert.equal((await post({ ...body, paymentMethodId: "bad token!" })).status, 400);
    assert.equal((await post({ ...body, guest: { ...guest, firstName: "" } })).status, 400);
    assert.equal(calls.length, 0);
  });

  it("does not leak Guesty's internal error text for server errors", async () => {
    fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { status: 500, body: { error: { message: "db connection string leaked" } } }));
    const r = await post(body);
    assert.equal(r.status, 502);
    assert.ok(!r.body.includes("leaked"));
  });
});

describe("payment provider endpoint", () => {
  it("flags Stripe as unsupported and GuestyPay as supported", async () => {
    let type = "stripe";
    fakeFetch((c) => (c.url.pathname === "/oauth2/token" ? tokenOk : { body: { _id: "prov1", providerType: type } }));
    assert.equal(json(await routes.payment(ctx({ query: { id: "list01" } }))).supported, false);
    type = "guestypay";
    const { resetForTests } = await import("../lib/guesty");
    resetForTests();
    const r = json(await routes.payment(ctx({ query: { id: "list01" } })));
    assert.equal(r.supported, true);
    assert.equal(r.providerId, "prov1");
  });
});
