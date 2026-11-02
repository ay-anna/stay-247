import { addDays, eachNight, isDate, nightsBetween } from "./format";
import type { SearchParams, Stay } from "./types";

export const PAGE_SIZE = 12;
export const SORTS: Record<string, string> = {
  "": "Featured",
  "price": "Price (low to high)",
  "price-d": "Price (high to low)",
  "name": "Name (A-Z)",
  "name-d": "Name (Z-A)",
  "city": "Location (A-Z)",
};

const clampInt = (v: string | undefined, min: number, max: number): number => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};

/** Reads the filter form's query string. Anything odd is dropped rather than trusted. */
export function parseSearch(q: Record<string, string>, today: string): SearchParams {
  const p: SearchParams = {
    city: (q.city ?? "").slice(0, 80) || undefined,
    guests: clampInt(q.guests, 0, 40) || undefined,
    beds: clampInt(q.beds, 0, 20) || undefined,
    pets: q.pets === "1" || undefined,
    q: (q.q ?? "").trim().slice(0, 80) || undefined,
    sort: q.sort && q.sort in SORTS ? q.sort : undefined,
    page: clampInt(q.page, 1, 500) || 1,
  };
  if (isDate(q.checkIn) && isDate(q.checkOut) && q.checkIn >= today && q.checkOut > q.checkIn && nightsBetween(q.checkIn, q.checkOut) <= 90) {
    p.checkIn = q.checkIn;
    p.checkOut = q.checkOut;
  }
  return p;
}

/**
 * When the list was fetched with dates, each stay carries an allotment per night.
 * A stay is kept unless Guesty says at least one night has no availability.
 */
export function filterAvailable(stays: Stay[], checkIn: string, checkOut: string): Stay[] {
  const nights = eachNight(checkIn, checkOut);
  return stays.filter((s) => {
    if (!s.allotment) return true;
    return nights.every((n) => s.allotment![n] === undefined || s.allotment![n] >= 1);
  });
}

/** Average nightly price for the searched dates if Guesty sent rates, otherwise the base price. */
export function nightlyFrom(stay: Stay, checkIn?: string, checkOut?: string): { amount: number; forDates: boolean } {
  if (checkIn && checkOut && stay.nightlyRates) {
    const rates = eachNight(checkIn, checkOut)
      .map((n) => stay.nightlyRates![n])
      .filter((r): r is number => typeof r === "number" && r > 0);
    if (rates.length) return { amount: rates.reduce((a, b) => a + b, 0) / rates.length, forDates: true };
  }
  return { amount: stay.basePrice, forDates: false };
}

export interface SearchResult {
  items: Stay[];
  total: number;
  page: number;
  pages: number;
  from: number;
  to: number;
  cities: string[];
  maxSleeps: number;
}

export function searchStays(all: Stay[], p: SearchParams): SearchResult {
  const kw = (p.q ?? "").toLowerCase();
  let list = all.filter((s) => {
    if (p.city && s.city.toLowerCase() !== p.city.toLowerCase()) return false;
    if (p.guests && s.sleeps < p.guests) return false;
    if (p.beds && s.bedrooms < p.beds) return false;
    if (p.pets && !s.pets) return false;
    if (kw) {
      const hay = [s.title, s.city, s.summary, s.amenities.join(" "), s.sections.map((x) => x.text).join(" ")].join(" ").toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  const price = (s: Stay) => nightlyFrom(s, p.checkIn, p.checkOut).amount;
  const by: Record<string, (a: Stay, b: Stay) => number> = {
    "price": (a, b) => price(a) - price(b),
    "price-d": (a, b) => price(b) - price(a),
    "name": (a, b) => a.title.localeCompare(b.title),
    "name-d": (a, b) => b.title.localeCompare(a.title),
    "city": (a, b) => a.city.localeCompare(b.city) || a.title.localeCompare(b.title),
  };
  if (p.sort && by[p.sort]) list = [...list].sort(by[p.sort]);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, p.page ?? 1), pages);
  const start = (page - 1) * PAGE_SIZE;
  const cities = [...new Set(all.map((s) => s.city).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const maxSleeps = Math.max(8, ...all.map((s) => s.sleeps));
  return { items: list.slice(start, start + PAGE_SIZE), total, page, pages, from: total ? start + 1 : 0, to: Math.min(total, start + PAGE_SIZE), cities, maxSleeps };
}

export { addDays };
