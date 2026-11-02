/**
 * A tiny pretend Guesty, used when GUESTY_MOCK=1. It returns objects shaped like Guesty's real responses so the
 * same code paths run as in production. Nothing here is real data and no card is ever charged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDays, eachNight, hash, nightsBetween } from "./format";

const BASE_LISTINGS: any[] = [
  {
    _id: "mock-lyrebird", title: "Lyrebird Cottage", bedrooms: 4, bathrooms: 2, beds: 6, accommodates: 8, propertyType: "House",
    address: { city: "Wentworth Falls", state: "NSW", full: "Wentworth Falls NSW 2782, Australia", lat: -33.71, lng: 150.37 },
    amenities: ["Wifi", "Heating", "Fireplace", "Dishwasher", "BBQ"], prices: { basePrice: 560, currency: "AUD", cleaningFee: 180 },
    publicDescription: {
      summary: "Large timber cabin with a wood fire, a deep verandah and a short walk to the village.",
      space: "Open-plan living opens onto a wide deck. Four bedrooms sleep eight, with a bunk room for the kids.",
      neighborhood: "Quiet street, five minutes on foot to cafes and the walking tracks.",
      guestControls: { allowsPets: false },
    },
    terms: { minNights: 2, maxNights: 28, cancellation: "Moderate" }, defaultCheckInTime: "14:00", defaultCheckOutTime: "10:00",
    reviews: { avg: 4.8, total: 31 }, pictures: [],
  },
  {
    _id: "mock-cecils", title: "Cecils Chair", bedrooms: 3, bathrooms: 2, beds: 4, accommodates: 6, propertyType: "House",
    address: { city: "Blackheath", state: "NSW", full: "Blackheath NSW 2785, Australia" },
    amenities: ["Wifi", "Pets allowed", "Heating", "Fireplace"], prices: { basePrice: 520, currency: "AUD", cleaningFee: 150 },
    publicDescription: {
      summary: "Three bedroom cottage with a valley view, a fenced yard and room for the dog.",
      space: "A light-filled cottage with a sunny courtyard and a fully fenced garden.",
      guestControls: { allowsPets: true },
    },
    terms: { minNights: 2, cancellation: "Flexible" }, defaultCheckInTime: "15:00", defaultCheckOutTime: "10:00", pictures: [],
  },
  {
    _id: "mock-olive", title: "The Olive House", bedrooms: 4, bathrooms: 2, beds: 6, accommodates: 8, propertyType: "House",
    address: { city: "Katoomba", state: "NSW", full: "Katoomba NSW 2780, Australia" },
    amenities: ["Hot tub", "Sauna", "Wifi", "Dishwasher", "Game room"], prices: { basePrice: 750, currency: "AUD", cleaningFee: 220 },
    publicDescription: {
      summary: "Bushland retreat with a hot tub, a sauna and a games room for the kids.",
      space: "A private retreat backing onto bush, with a hot tub on the deck and a sauna for cold evenings.",
      guestControls: { allowsPets: false },
    },
    terms: { minNights: 3, cancellation: "Strict" }, defaultCheckInTime: "14:00", defaultCheckOutTime: "10:00",
    reviews: { avg: 4.9, total: 12 }, pictures: [],
  },
  {
    _id: "mock-castle", title: "The Castle", bedrooms: 4, bathrooms: 2, beds: 5, accommodates: 7, propertyType: "House",
    address: { city: "Wentworth Falls", state: "NSW", full: "Wentworth Falls NSW 2782, Australia" },
    amenities: ["Wifi", "Heating", "Garden"], prices: { basePrice: 590, currency: "AUD", cleaningFee: 190 },
    publicDescription: { summary: "Live the fairytale at the edge of the golf course.", space: "A turreted family home with garden views.", guestControls: { allowsPets: false } },
    terms: { minNights: 2 }, pictures: [],
  },
  {
    _id: "mock-greenhill", title: "Greenhill", bedrooms: 4, bathrooms: 3, beds: 9, accommodates: 16, propertyType: "House",
    address: { city: "Blackheath", state: "NSW", full: "Blackheath NSW 2785, Australia" },
    amenities: ["Wifi", "Tennis court", "Pool table", "Fireplace"], prices: { basePrice: 918, currency: "AUD", cleaningFee: 300 },
    publicDescription: { summary: "A full-size tennis court and games room make an ideal weekend retreat.", space: "Room for sixteen across four bedrooms and a loft.", guestControls: { allowsPets: false } },
    terms: { minNights: 2 }, pictures: [],
  },
];

function nightlyRate(listing: any, date: string): number {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  const weekend = day === 5 || day === 6;
  return Math.round(listing.prices.basePrice * (weekend ? 1.15 : 1));
}

/** Deterministic pretend bookings so the calendar has gaps to pick from. */
function isBooked(listingId: string, date: string): boolean {
  const n = Math.floor(new Date(date + "T00:00:00Z").getTime() / 86400000);
  const block = Math.floor((n + (hash(listingId) % 9)) / 6);
  return block % 4 === 1;
}

export function listings(query: Record<string, string | number | undefined>): any {
  const withDates = typeof query.checkIn === "string" && typeof query.checkOut === "string";
  const results = BASE_LISTINGS.map((l) => {
    const copy: any = { ...l };
    if (withDates) {
      const nights = eachNight(query.checkIn as string, query.checkOut as string);
      copy.allotment = Object.fromEntries(nights.map((d) => [d, isBooked(l._id, d) ? 0 : 1]));
      copy.nightlyRates = Object.fromEntries(nights.map((d) => [d, nightlyRate(l, d)]));
    }
    return copy;
  });
  const min = Number(query.minOccupancy) || 0;
  return { results: results.filter((l) => l.accommodates >= min), pagination: { total: results.length, cursor: {} } };
}

export function listing(id: string): any {
  const l = BASE_LISTINGS.find((x) => x._id === id);
  if (!l) {
    const err: any = new Error("Listing not found");
    err.status = 404;
    throw err;
  }
  return { results: l };
}

export function calendar(id: string, from: string, to: string): any[] {
  const l = BASE_LISTINGS.find((x) => x._id === id);
  if (!l) {
    const err: any = new Error("Listing not found");
    err.status = 404;
    throw err;
  }
  const out: any[] = [];
  const n = nightsBetween(from, to);
  for (let i = 0; i <= n; i++) {
    const date = addDays(from, i);
    const booked = isBooked(id, date);
    out.push({
      date,
      status: booked ? "booked" : "available",
      minNights: l.terms?.minNights ?? 1,
      isBaseMinNights: true,
      cta: false,
      ctd: false,
      allotment: booked ? 0 : 1,
    });
  }
  return out;
}

const quotes = new Map<string, any>();

export function createQuote(body: any): any {
  const l = BASE_LISTINGS.find((x) => x._id === body.listingId);
  if (!l) {
    const err: any = new Error("Listing not found");
    err.status = 404;
    throw err;
  }
  const nights = eachNight(body.checkInDateLocalized, body.checkOutDateLocalized);
  if (nights.some((d) => isBooked(l._id, d))) {
    const err: any = new Error("The listing is not available for those dates");
    err.status = 400;
    throw err;
  }
  const accommodation = nights.reduce((sum, d) => sum + nightlyRate(l, d), 0);
  const cleaning = l.prices.cleaningFee;
  const taxes = Math.round((accommodation + cleaning) * 0.1);
  const id = "mock-quote-" + Math.random().toString(36).slice(2, 10);
  const quote = {
    _id: id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    guestId: "mock-guest",
    rates: {
      ratePlans: [
        {
          _id: "mock-rate-standard",
          name: "Standard rate",
          type: "standard",
          cancellationPolicy: l.terms?.cancellation ?? "Moderate",
          money: {
            currency: "AUD",
            fareAccommodation: accommodation,
            fareCleaning: cleaning,
            totalFees: cleaning,
            subTotalPrice: accommodation + cleaning,
            totalTaxes: taxes,
            hostPayout: accommodation + cleaning + taxes,
            invoiceItems: [
              { title: `${nights.length} nights`, amount: accommodation },
              { title: "Cleaning fee", amount: cleaning },
              { title: "GST", amount: taxes },
            ],
          },
        },
      ],
    },
  };
  quotes.set(id, { quote, used: false });
  return quote;
}

export function instantCharge(quoteId: string, body: any): any {
  const entry = quotes.get(quoteId);
  if (!entry) {
    const err: any = new Error("Quote not found");
    err.status = 404;
    throw err;
  }
  if (entry.used) {
    const err: any = new Error("Inquiry is already fulfilled by a reservation");
    err.status = 400;
    throw err;
  }
  entry.used = true;
  const plan = entry.quote.rates.ratePlans.find((p: any) => p._id === body.ratePlanId);
  if (!plan) {
    const err: any = new Error("Unknown rate plan");
    err.status = 400;
    throw err;
  }
  const declined = body.initialPaymentMethodId === "mock-pm-decline";
  const code = "DEMO" + Math.random().toString(36).slice(2, 8).toUpperCase();
  return {
    reservation: { _id: "mock-res-" + code, confirmationCode: code, status: declined ? "canceled" : "confirmed", source: "direct" },
    payment: declined
      ? { _id: "mock-pay", status: "FAILED", amount: plan.money.hostPayout, currency: "AUD", error: "Your card was declined" }
      : { _id: "mock-pay", status: "SUCCEEDED", amount: plan.money.hostPayout, currency: "AUD", paidAt: new Date().toISOString() },
  };
}

export function paymentProvider(_listingId: string): any {
  return { _id: "mock-provider", providerType: "mock", providerAccountId: "mock", status: "active", paymentProcessorName: "Demo", accountName: "Demo" };
}
