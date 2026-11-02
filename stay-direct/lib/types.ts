export interface Photo {
  url: string;
  thumb: string;
  caption?: string;
}

/** A property as this site uses it, normalised from Guesty's listing object. */
export interface Stay {
  id: string;
  title: string;
  city: string;
  state?: string;
  address?: string;
  lat?: number;
  lng?: number;
  propertyType?: string;
  bedrooms: number;
  bathrooms: number;
  beds: number;
  sleeps: number;
  pets: boolean;
  amenities: string[];
  photos: Photo[];
  basePrice: number;
  currency: string;
  summary: string;
  sections: { heading: string; text: string }[];
  minNights?: number;
  maxNights?: number;
  checkInTime?: string;
  checkOutTime?: string;
  cancellation?: string;
  rating?: { avg: number; total: number };
  /** Only present when the list was requested with check-in and check-out dates. */
  allotment?: Record<string, number>;
  nightlyRates?: Record<string, number>;
}

export interface CalendarDay {
  date: string;
  status: string;
  minNights: number;
  cta: boolean;
  ctd: boolean;
}

export interface QuoteItem {
  title: string;
  amount: number;
}

export interface RatePlanView {
  id: string;
  name: string;
  cancellation?: string;
  total: number;
  items: QuoteItem[];
}

export interface QuoteView {
  quoteId: string;
  expiresAt?: string;
  currency: string;
  nights: number;
  checkIn: string;
  checkOut: string;
  guests: number;
  ratePlans: RatePlanView[];
}

export interface SearchParams {
  city?: string;
  guests?: number;
  beds?: number;
  pets?: boolean;
  q?: string;
  sort?: string;
  page?: number;
  checkIn?: string;
  checkOut?: string;
}

export interface Ctx {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  host?: string;
}

export interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}
