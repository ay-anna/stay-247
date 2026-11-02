export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function money(n: number, currency = "AUD", locale = "en-AU"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return "$" + Math.round(n).toLocaleString(locale);
  }
}

export function moneyExact(n: number, currency = "AUD", locale = "en-AU"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return "$" + n.toFixed(2);
  }
}

export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn + "T00:00:00Z").getTime();
  const b = new Date(checkOut + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

/** The nights of a stay: check-in day up to, not including, check-out day. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const n = nightsBetween(checkIn, checkOut);
  for (let i = 0; i < n; i++) out.push(addDays(checkIn, i));
  return out;
}

export function todayISO(timeZone = "Australia/Sydney"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** "WIFI" or "Pets allowed" or "hot_tub" to "Wifi", "Pets allowed", "Hot tub". */
export function humanize(s: string): string {
  const t = String(s).replace(/_/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function formatDateLong(date: string, locale = "en-AU"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(date + "T00:00:00Z"),
  );
}

export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
