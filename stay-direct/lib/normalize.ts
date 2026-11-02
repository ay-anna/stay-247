import type { CalendarDay, Photo, QuoteItem, QuoteView, RatePlanView, Stay } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function photosOf(raw: any): Photo[] {
  const list: any[] = Array.isArray(raw.pictures) && raw.pictures.length ? raw.pictures : raw.picture ? [raw.picture] : [];
  const out: Photo[] = [];
  for (const p of list) {
    const url = str(p?.large) || str(p?.regular) || str(p?.original);
    if (!url) continue;
    out.push({ url, thumb: str(p?.thumbnail) || str(p?.regular) || url, caption: str(p?.caption) || undefined });
  }
  return out;
}

function petsOf(raw: any): boolean {
  const gc = raw.publicDescription?.guestControls;
  if (typeof gc?.allowsPets === "boolean") return gc.allowsPets;
  const rule = raw.unitTypeHouseRules?.houseRules?.petsAllowed;
  if (typeof rule?.enabled === "boolean") return rule.enabled;
  const amenities: unknown[] = Array.isArray(raw.amenities) ? raw.amenities : [];
  return amenities.some((a) => /^pets[ _]allowed$/i.test(String(a)));
}

const SECTIONS: [string, string][] = [
  ["space", "The space"],
  ["access", "Guest access"],
  ["neighborhood", "The neighbourhood"],
  ["transit", "Getting around"],
  ["notes", "Good to know"],
  ["houseRules", "House rules"],
];

export function normalizeStay(raw: any): Stay {
  const pd = raw.publicDescription ?? {};
  const sections = SECTIONS.map(([key, heading]) => ({ heading, text: str(pd[key]) })).filter((s) => s.text);
  const addr = raw.address ?? {};
  const rating = raw.reviews && num(raw.reviews.total) > 0 ? { avg: num(raw.reviews.avg), total: num(raw.reviews.total) } : undefined;
  return {
    id: String(raw._id),
    title: str(raw.title) || str(raw.nickname) || "Holiday home",
    city: str(addr.city),
    state: str(addr.state) || undefined,
    address: str(addr.full) || undefined,
    lat: typeof addr.lat === "number" ? addr.lat : undefined,
    lng: typeof addr.lng === "number" ? addr.lng : undefined,
    propertyType: str(raw.propertyType) || undefined,
    bedrooms: num(raw.bedrooms),
    bathrooms: num(raw.bathrooms),
    beds: num(raw.beds),
    sleeps: num(raw.accommodates),
    pets: petsOf(raw),
    amenities: Array.isArray(raw.amenities) ? raw.amenities.map(String) : [],
    photos: photosOf(raw),
    basePrice: num(raw.prices?.basePrice),
    currency: str(raw.prices?.currency) || "AUD",
    summary: str(pd.summary),
    sections,
    minNights: raw.terms?.minNights ? num(raw.terms.minNights) : undefined,
    maxNights: raw.terms?.maxNights ? num(raw.terms.maxNights) : undefined,
    checkInTime: str(raw.defaultCheckInTime) || undefined,
    checkOutTime: str(raw.defaultCheckOutTime) || undefined,
    cancellation: str(raw.terms?.cancellation) || undefined,
    rating,
    allotment: raw.allotment && typeof raw.allotment === "object" ? raw.allotment : undefined,
    nightlyRates: raw.nightlyRates && typeof raw.nightlyRates === "object" ? raw.nightlyRates : undefined,
  };
}

export function normalizeCalendar(raw: any): CalendarDay[] {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.days) ? raw.days : [];
  return list
    .filter((d) => typeof d?.date === "string")
    .map((d) => ({
      date: d.date.slice(0, 10),
      status: String(d.status ?? "unavailable"),
      minNights: Math.max(1, num(d.minNights, 1)),
      cta: Boolean(d.cta),
      ctd: Boolean(d.ctd),
    }));
}

/**
 * The amount the guest pays for a rate plan. Guesty's payout schedule treats the quote's hostPayout as the
 * total, so that is used first. If it is missing, fall back to the sub total plus taxes.
 * Check this against a test quote in your Guesty dashboard before going live.
 */
export function quoteTotal(money: any): number {
  if (typeof money?.hostPayout === "number") return money.hostPayout;
  return num(money?.subTotalPrice) + num(money?.totalTaxes);
}

function itemsOf(money: any): QuoteItem[] {
  const fromInvoice: QuoteItem[] = (Array.isArray(money?.invoiceItems) ? money.invoiceItems : [])
    .map((it: any) => ({ title: str(it?.title) || str(it?.normalType) || str(it?.type) || "Charge", amount: num(it?.amount, NaN) }))
    .filter((it: QuoteItem) => Number.isFinite(it.amount) && it.amount !== 0);
  if (fromInvoice.length) return fromInvoice;
  const cleaning = num(money?.fareCleaning);
  const otherFees = Math.max(0, num(money?.totalFees) - cleaning);
  const items: QuoteItem[] = [{ title: "Accommodation", amount: num(money?.fareAccommodation) }];
  if (cleaning) items.push({ title: "Cleaning fee", amount: cleaning });
  if (otherFees) items.push({ title: "Other fees", amount: otherFees });
  if (num(money?.totalTaxes)) items.push({ title: "Taxes", amount: num(money.totalTaxes) });
  return items;
}

export function normalizeQuote(raw: any, ctx: { checkIn: string; checkOut: string; nights: number; guests: number }): QuoteView {
  const plans: any[] = Array.isArray(raw?.rates?.ratePlans) ? raw.rates.ratePlans : [];
  const ratePlans: RatePlanView[] = plans.map((p) => ({
    id: String(p._id),
    name: str(p.name) || "Standard rate",
    cancellation: typeof p.cancellationPolicy === "string" ? p.cancellationPolicy : undefined,
    total: quoteTotal(p.money),
    items: itemsOf(p.money),
  }));
  const currency = str(plans[0]?.money?.currency) || "AUD";
  return {
    quoteId: String(raw?._id),
    expiresAt: typeof raw?.expiresAt === "string" ? raw.expiresAt : undefined,
    currency,
    nights: ctx.nights,
    checkIn: ctx.checkIn,
    checkOut: ctx.checkOut,
    guests: ctx.guests,
    ratePlans,
  };
}
