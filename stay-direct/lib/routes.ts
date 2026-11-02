/* eslint-disable @typescript-eslint/no-explicit-any */
import { site } from "./config";
import { addDays, isDate, nightsBetween, todayISO } from "./format";
import { createQuote, getCalendar, getPaymentProvider, getStay, instantCharge, listStays, verifyPayment } from "./guesty";
import { asRecord, describe, failJson, htmlRes, HttpError, isEmail, isId, json, text } from "./http";
import { errorPage, homePage, stayPage } from "./render";
import { filterAvailable, parseSearch, searchStays } from "./search";
import type { Ctx, Res } from "./types";

const requirePost = (ctx: Ctx) => {
  if (ctx.method !== "POST") throw new HttpError(405, "Use POST.", "method");
};

function pageError(e: unknown): Res {
  const d = describe(e);
  if (d.status === 404) return htmlRes(404, errorPage("Property not found", "That property is not available. It may have been removed."));
  return htmlRes(d.status >= 500 ? 503 : d.status, errorPage("We could not load the stays", d.message), { "cache-control": "no-store" });
}

/* ---------- pages ---------- */

export async function home(ctx: Ctx): Promise<Res> {
  try {
    const today = todayISO(site().timeZone);
    const p = parseSearch(ctx.query, today);
    const dated = p.checkIn && p.checkOut;
    let stays = await listStays(dated ? { checkIn: p.checkIn, checkOut: p.checkOut, minOccupancy: p.guests } : {});
    if (dated) stays = filterAvailable(stays, p.checkIn!, p.checkOut!);
    // Cities and the guest list come from every property, not just the matches.
    const all = dated ? await listStays({}).catch(() => stays) : stays;
    const result = searchStays(stays, p);
    const full = searchStays(all, {});
    result.cities = full.cities;
    result.maxSleeps = full.maxSleeps;
    const html = homePage(result, p, today, all.length);
    return htmlRes(200, html, { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" });
  } catch (e) {
    return pageError(e);
  }
}

export async function stay(ctx: Ctx): Promise<Res> {
  const id = ctx.query.id;
  if (!isId(id)) return htmlRes(404, errorPage("Property not found", "That address does not match a property."));
  try {
    const today = todayISO(site().timeZone);
    const s = await getStay(id);
    const q = ctx.query;
    const prefill: { checkIn?: string; checkOut?: string; guests?: number } = {};
    if (isDate(q.checkIn) && isDate(q.checkOut) && q.checkIn >= today && q.checkOut > q.checkIn) {
      prefill.checkIn = q.checkIn;
      prefill.checkOut = q.checkOut;
    }
    const g = parseInt(q.guests ?? "", 10);
    if (g >= 1 && g <= s.sleeps) prefill.guests = g;
    return htmlRes(200, stayPage(s, prefill, today), { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" });
  } catch (e) {
    return pageError(e);
  }
}

export async function sitemap(ctx: Ctx): Promise<Res> {
  try {
    const base = site().baseUrl || (ctx.host ? `https://${ctx.host}` : "");
    const stays = await listStays({});
    const urls = ["/", ...stays.map((s) => `/stays/${encodeURIComponent(s.id)}`)];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${base}${u}</loc></url>`)
      .join("\n")}\n</urlset>`;
    return { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, s-maxage=3600" }, body: xml };
  } catch (e) {
    return failJson(e);
  }
}

/* ---------- JSON API used by the booking widget ---------- */

export async function calendar(ctx: Ctx): Promise<Res> {
  try {
    const { id, from, to } = ctx.query;
    if (!isId(id)) throw new HttpError(400, "Unknown property.");
    if (!isDate(from) || !isDate(to) || to < from || nightsBetween(from, to) > 800) throw new HttpError(400, "Choose a valid date range.");
    const days = await getCalendar(id, from, to);
    return json(200, { days }, { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" });
  } catch (e) {
    return failJson(e);
  }
}

export async function quote(ctx: Ctx): Promise<Res> {
  try {
    requirePost(ctx);
    const b = asRecord(ctx.body);
    const today = todayISO(site().timeZone);
    if (!isId(b.listingId)) throw new HttpError(400, "Unknown property.");
    if (!isDate(b.checkIn) || !isDate(b.checkOut)) throw new HttpError(400, "Choose your arrival and departure dates.");
    if (b.checkIn < today) throw new HttpError(400, "Arrival must be today or later.");
    const nights = nightsBetween(b.checkIn, b.checkOut);
    if (nights < 1 || nights > 365) throw new HttpError(400, "Choose between 1 and 365 nights.");
    const guests = Number(b.guests);
    if (!Number.isInteger(guests) || guests < 1 || guests > 40) throw new HttpError(400, "Choose the number of guests.");
    let coupon: string | undefined;
    if (b.coupon !== undefined && b.coupon !== "") {
      if (typeof b.coupon !== "string" || !/^[\w-]{1,40}$/.test(b.coupon)) throw new HttpError(400, "That coupon code looks wrong.");
      coupon = b.coupon;
    }
    const q = await createQuote({ listingId: b.listingId, checkIn: b.checkIn, checkOut: b.checkOut, guests, coupon });
    if (!q.ratePlans.length) throw new HttpError(409, "Those dates are not available. Please try other dates.", "unavailable");
    return json(200, q);
  } catch (e) {
    return failJson(e);
  }
}

export async function payment(ctx: Ctx): Promise<Res> {
  try {
    const id = ctx.query.id;
    if (!isId(id)) throw new HttpError(400, "Unknown property.");
    const p = await getPaymentProvider(id);
    const type = String(p?.providerType ?? "").toLowerCase();
    return json(
      200,
      {
        providerType: type,
        // The SDK's providerId is the id of the payment provider record Guesty returns for the listing.
        providerId: String(p?._id ?? p?.paymentProcessorId ?? ""),
        mock: type === "mock",
        supported: type === "mock" || (type !== "" && !type.includes("stripe")),
      },
      { "cache-control": "public, s-maxage=300" },
    );
  } catch (e) {
    return failJson(e);
  }
}

function friendlyPaymentError(v: unknown): string {
  const generic = "The payment did not go through. Please check your card details or try another card.";
  return typeof v === "string" && v.length > 0 && v.length < 140 ? v : generic;
}

/** Reads Guesty's reply to a charge or a 3-D Secure check and decides what the guest should see. */
export function interpretCharge(out: any): Res {
  const pay = out?.payment;
  const res = out?.reservation;
  if (out?.threeDSChallenge || String(pay?.status ?? "").toUpperCase() === "PENDING_AUTH") {
    return json(200, { status: "needs_3ds", threeDSChallenge: out.threeDSChallenge, paymentId: pay?._id, reservationId: res?._id });
  }
  const confirmed = String(res?.status ?? "").toLowerCase() === "confirmed";
  if (confirmed && !pay?.error && !pay?.processorError) {
    return json(200, { status: "confirmed", confirmationCode: res?.confirmationCode ?? null, reservationId: res?._id ?? null });
  }
  return json(402, { error: { message: friendlyPaymentError(pay?.error ?? pay?.processorError), code: "payment_failed" } });
}

export async function book(ctx: Ctx): Promise<Res> {
  try {
    requirePost(ctx);
    const b = asRecord(ctx.body);
    const g = asRecord(b.guest);
    if (!isId(b.quoteId)) throw new HttpError(400, "Your price quote is missing. Please choose your dates again.");
    if (!isId(b.ratePlanId)) throw new HttpError(400, "Please choose a rate.");
    if (typeof b.paymentMethodId !== "string" || !/^[\w-]{3,128}$/.test(b.paymentMethodId)) throw new HttpError(400, "We could not read your card details. Please try again.");
    if (b.acceptedTerms !== true) throw new HttpError(400, "Please accept the booking terms to continue.");
    const email = typeof g.email === "string" ? g.email.trim() : "";
    if (!isEmail(email)) throw new HttpError(400, "Please enter a valid email address.");
    const phone = text(g.phone, 30, "a phone number", false);
    const guest = { firstName: text(g.firstName, 60, "your first name"), lastName: text(g.lastName, 60, "your last name"), email, ...(phone ? { phone } : {}) };
    const now = new Date().toISOString();
    const out = await instantCharge(b.quoteId, {
      ratePlanId: b.ratePlanId,
      initialPaymentMethodId: b.paymentMethodId,
      guest,
      policy: { termsAndConditions: { isAccepted: true, dateOfAcceptance: now }, marketing: { isAccepted: b.marketing === true } },
    });
    return interpretCharge(out);
  } catch (e) {
    return failJson(e);
  }
}

export async function verify(ctx: Ctx): Promise<Res> {
  try {
    requirePost(ctx);
    const b = asRecord(ctx.body);
    if (!isId(b.reservationId) || !isId(b.paymentId)) throw new HttpError(400, "That confirmation request was not understood.");
    const out = await verifyPayment(b.reservationId, { paymentId: b.paymentId, ...(b.threeDSResult ? { threeDSResult: b.threeDSResult } : {}) });
    return interpretCharge(out);
  } catch (e) {
    return failJson(e);
  }
}

export { addDays };
