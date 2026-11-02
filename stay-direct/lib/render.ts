import { site, isMock } from "./config";
import { esc, formatDateLong, hash, humanize, money } from "./format";
import { nightlyFrom, SORTS, type SearchResult } from "./search";
import type { SearchParams, Stay } from "./types";

/* ---------- contour art (the topographic lines used for hero and photo-less cards) ---------- */

function rng(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function contours(seed: number, rings: number): string {
  const r = rng(seed);
  const cx = 50 + r() * 100;
  const cy = 30 + r() * 60;
  const a = [r() * 6, r() * 6, r() * 6];
  const b = [0.06 + r() * 0.08, 0.05 + r() * 0.07, 0.04 + r() * 0.06];
  let out = "";
  for (let i = 1; i <= rings; i++) {
    const base = i * (110 / rings) * 0.9;
    let d = "";
    for (let k = 0; k <= 72; k++) {
      const t = (k / 72) * Math.PI * 2;
      const rad = base * (1 + b[0] * Math.sin(2 * t + a[0]) + b[1] * Math.sin(3 * t + a[1]) + b[2] * Math.sin(5 * t + a[2]));
      d += (k ? "L" : "M") + (cx + rad * 1.7 * Math.cos(t)).toFixed(1) + " " + (cy + rad * Math.sin(t)).toFixed(1);
    }
    out += `<path d="${d}Z"/>`;
  }
  return `<svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="none" stroke="currentColor" stroke-width=".45">${out}</svg>`;
}

function placeholder(s: Stay): string {
  return `<div class="ph ph${(hash(s.id) % 4) + 1}">${contours(hash(s.title), 9)}<span>${esc(s.city)}</span></div>`;
}

/* ---------- layout ---------- */

interface LayoutOptions {
  title: string;
  description: string;
  canonical?: string;
  body: string;
  scripts?: string;
  jsonLd?: unknown;
  noindex?: boolean;
  image?: string;
}

export function layout(o: LayoutOptions): string {
  const s = site();
  const contact = [s.phone, s.email].filter(Boolean).map(esc).join('<span aria-hidden="true"> &middot; </span>');
  const ld = o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, "\\u003c")}</script>` : "";
  return `<!doctype html>
<html lang="${esc(s.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : ""}
${o.noindex ? '<meta name="robots" content="noindex">' : ""}
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:type" content="website">
${o.image ? `<meta property="og:image" content="${esc(o.image)}">` : ""}
<meta name="theme-color" content="#0E3B37">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Figtree:wght@400..700&display=swap">
<link rel="stylesheet" href="/styles.css">
${ld}
</head>
<body>
${isMock() ? '<div class="mockbar">Demo mode. These are sample properties and no card is charged.</div>' : ""}
<header class="bar"><div class="wrap barin">
  <a class="brand" href="/">${esc(s.brand)}</a>
  <div class="contact">${contact}</div>
</div></header>
<main>
${o.body}
</main>
<footer class="sitefoot"><div class="wrap footin">
  <span>${esc(s.brand)}</span>
  <span>${contact}</span>
  <span class="links">${s.termsUrl ? `<a href="${esc(s.termsUrl)}">Terms</a>` : ""}${s.privacyUrl ? `<a href="${esc(s.privacyUrl)}">Privacy</a>` : ""}</span>
</div></footer>
<script src="/site.js" defer></script>
${o.scripts ?? ""}
</body>
</html>`;
}

/* ---------- list page ---------- */

function queryString(p: SearchParams, extra: Record<string, string | number | undefined> = {}): string {
  const q = new URLSearchParams();
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== "" && v !== false && v !== 0) q.set(k, String(v));
  };
  set("city", p.city);
  set("checkIn", p.checkIn);
  set("checkOut", p.checkOut);
  set("guests", p.guests);
  set("beds", p.beds);
  set("pets", p.pets ? "1" : "");
  set("q", p.q);
  set("sort", p.sort);
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) q.delete(k);
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function stayHref(s: Stay, p: SearchParams): string {
  const q = new URLSearchParams();
  if (p.checkIn && p.checkOut) {
    q.set("checkIn", p.checkIn);
    q.set("checkOut", p.checkOut);
  }
  if (p.guests) q.set("guests", String(p.guests));
  const qs = q.toString();
  return `/stays/${encodeURIComponent(s.id)}${qs ? `?${qs}` : ""}`;
}

function specs(s: Stay): string {
  return `<ul class="specs">
  <li><b>${s.bedrooms}</b><span>Bedrooms</span></li>
  <li><b>${s.bathrooms}</b><span>Bathrooms</span></li>
  <li><b>${s.sleeps}</b><span>Sleeps</span></li>
  ${s.pets ? '<li><b>Yes</b><span>Pet friendly</span></li>' : ""}
</ul>`;
}

function card(s: Stay, p: SearchParams): string {
  const href = stayHref(s, p);
  const img = s.photos[0] ? `<img src="${esc(s.photos[0].thumb)}" alt="${esc(s.title)}" loading="lazy" decoding="async">` : placeholder(s);
  const price = nightlyFrom(s, p.checkIn, p.checkOut);
  return `<article class="card">
  <a class="media" href="${esc(href)}" aria-label="View ${esc(s.title)}">${img}</a>
  <div class="body">
    <div class="suburb">${esc(s.city)}</div>
    <h3><a href="${esc(href)}">${esc(s.title)}</a></h3>
    ${specs(s)}
    ${s.summary ? `<p class="blurb">${esc(s.summary)}</p>` : ""}
    <div class="foot">
      <div class="price"><small>${price.forDates ? "Avg" : "From"}</small> <b>${money(price.amount, s.currency, site().locale)}</b> <small>per night</small></div>
      <a class="btn" href="${esc(href)}">View property</a>
    </div>
  </div>
</article>`;
}

function pagination(r: SearchResult, p: SearchParams): string {
  if (r.pages <= 1) return "";
  const link = (n: number, label: string, current = false) =>
    `<a class="pg${current ? " cur" : ""}" href="/${queryString(p, { page: n === 1 ? undefined : n })}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
  const nums: string[] = [];
  for (let n = 1; n <= r.pages; n++) {
    if (n === 1 || n === r.pages || Math.abs(n - r.page) <= 1) nums.push(link(n, String(n), n === r.page));
    else if (nums[nums.length - 1] !== '<span class="gap">&hellip;</span>') nums.push('<span class="gap">&hellip;</span>');
  }
  return `<nav class="pager" aria-label="Pages">${r.page > 1 ? link(r.page - 1, "Previous") : ""}${nums.join("")}${r.page < r.pages ? link(r.page + 1, "Next") : ""}</nav>`;
}

export function homePage(r: SearchResult, p: SearchParams, today: string, total: number): string {
  const s = site();
  const opt = (value: string, label: string, sel: boolean) => `<option value="${esc(value)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
  const guestsOpts = [opt("", "Any", !p.guests)];
  for (let i = 1; i <= r.maxSleeps; i++) guestsOpts.push(opt(String(i), i === 1 ? "1 guest" : `${i} guests`, p.guests === i));
  const bedOpts = [opt("", "Any", !p.beds)];
  for (let i = 1; i <= 6; i++) bedOpts.push(opt(String(i), `${i}+`, p.beds === i));
  const filtersActive = Boolean(p.city || p.guests || p.beds || p.pets || p.q || p.checkIn);

  const results = r.items.length
    ? `<div class="grid">${r.items.map((x) => card(x, p)).join("")}</div>${pagination(r, p)}`
    : `<div class="notice"><h3>${total ? "No stays match those filters" : "No properties to show yet"}</h3><p>${
        total ? "Try different dates, fewer filters or another location." : "Check back soon."
      }</p>${filtersActive ? '<a class="btn ghost" href="/">Clear filters</a>' : ""}</div>`;

  const body = `<section class="hero">
  <div class="contours">${contours(7, 14)}</div>
  <div class="wrap">
    <h1>${esc(s.heroTitle)}</h1>
    <p class="tag">${esc(s.tagline)}</p>
  </div>
</section>
<div class="wrap">
  <form class="filters" method="get" action="/" aria-label="Find a stay">
    <div class="field"><label for="f-city">Location</label>
      <select id="f-city" name="city">${opt("", "All locations", !p.city)}${r.cities.map((c) => opt(c, c, p.city?.toLowerCase() === c.toLowerCase())).join("")}</select></div>
    <div class="field"><label for="f-in">Arrival</label><input id="f-in" name="checkIn" type="date" min="${today}" value="${esc(p.checkIn ?? "")}"></div>
    <div class="field"><label for="f-out">Departure</label><input id="f-out" name="checkOut" type="date" min="${today}" value="${esc(p.checkOut ?? "")}"></div>
    <div class="field"><label for="f-guests">Guests</label><select id="f-guests" name="guests">${guestsOpts.join("")}</select></div>
    <div class="field"><label for="f-beds">Bedrooms</label><select id="f-beds" name="beds">${bedOpts.join("")}</select></div>
    <div class="field"><label for="f-q">Keyword</label><input id="f-q" name="q" type="search" placeholder="Hot tub, view, cottage" value="${esc(p.q ?? "")}"></div>
    <div class="field"><label for="f-sort">Sort</label>
      <select id="f-sort" name="sort">${Object.entries(SORTS).map(([k, v]) => opt(k, v, (p.sort ?? "") === k)).join("")}</select></div>
    <label class="check"><input type="checkbox" name="pets" value="1"${p.pets ? " checked" : ""}> Pet friendly</label>
    <div class="actions"><button class="btn" type="submit">Search</button>${filtersActive ? '<a class="btn ghost" href="/">Clear</a>' : ""}</div>
  </form>
  <div class="results-head">
    <h2>${p.checkIn && p.checkOut ? `Available ${esc(formatDateLong(p.checkIn))} to ${esc(formatDateLong(p.checkOut))}` : "Our stays"}</h2>
    <span class="count" aria-live="polite">${r.total ? `Showing ${r.from}-${r.to} of ${r.total} ${r.total === 1 ? "property" : "properties"}` : ""}</span>
  </div>
  ${results}
</div>`;

  return layout({
    title: `${s.brand} | ${s.heroTitle}`,
    description: s.tagline,
    canonical: s.baseUrl ? `${s.baseUrl}/` : undefined,
    body,
    noindex: Boolean(p.q || p.checkIn || p.page && p.page > 1),
  });
}

/* ---------- detail page ---------- */

function paragraphs(t: string): string {
  return t
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p>${esc(x).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function clock(t?: string): string {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}${m[2] === "00" ? "" : ":" + m[2]} ${suffix}`;
}

export function stayPage(s: Stay, prefill: { checkIn?: string; checkOut?: string; guests?: number }, today: string): string {
  const cfg = site();
  const gallery = s.photos.length
    ? `<div class="gallery"><div class="main"><img id="main-photo" src="${esc(s.photos[0].url)}" alt="${esc(s.title)}"></div>${
        s.photos.length > 1
          ? `<div class="thumbs">${s.photos
              .map((p, i) => `<button type="button" data-photo="${esc(p.url)}" aria-label="Photo ${i + 1}"${i === 0 ? ' aria-current="true"' : ""}><img src="${esc(p.thumb)}" alt="" loading="lazy"></button>`)
              .join("")}</div>`
          : ""
      }</div>`
    : `<div class="gallery"><div class="main">${placeholder(s)}</div></div>`;

  const facts: [string, string][] = [];
  if (s.checkInTime) facts.push(["Check in", clock(s.checkInTime)]);
  if (s.checkOutTime) facts.push(["Check out", clock(s.checkOutTime)]);
  if (s.minNights) facts.push(["Minimum stay", `${s.minNights} ${s.minNights === 1 ? "night" : "nights"}`]);
  if (s.cancellation) facts.push(["Cancellation", humanize(s.cancellation)]);
  facts.push(["Pets", s.pets ? "Welcome" : "Not allowed"]);

  const sections = s.sections.filter((x) => x.heading !== "House rules");
  const rules = s.sections.find((x) => x.heading === "House rules");

  const widgetData = {
    id: s.id,
    title: s.title,
    sleeps: s.sleeps,
    minNights: s.minNights ?? 1,
    maxNights: s.maxNights ?? 0,
    currency: s.currency,
    basePrice: s.basePrice,
    today,
    locale: cfg.locale,
    prefill,
    termsUrl: cfg.termsUrl,
    privacyUrl: cfg.privacyUrl,
    phone: cfg.phone,
    email: cfg.email,
  };

  const body = `<div class="wrap">
  <a class="back" href="/">&larr; All stays</a>
  <div class="dhead">
    <div>
      <div class="suburb">${esc([s.city, s.state].filter(Boolean).join(", "))}</div>
      <h1>${esc(s.title)}</h1>
      ${s.rating ? `<div class="addr">${s.rating.avg.toFixed(1)} out of 5 from ${s.rating.total} ${s.rating.total === 1 ? "review" : "reviews"}</div>` : ""}
    </div>
    ${specs(s)}
  </div>
  <div class="dgrid">
    <div class="dmain">
      ${gallery}
      ${s.summary ? `<div class="dsection"><h2>About this stay</h2>${paragraphs(s.summary)}</div>` : ""}
      ${sections.map((x) => `<div class="dsection"><h2>${esc(x.heading)}</h2>${paragraphs(x.text)}</div>`).join("")}
      ${s.amenities.length ? `<div class="dsection"><h2>What is included</h2><ul class="chips">${s.amenities.map((a) => `<li>${esc(humanize(a))}</li>`).join("")}</ul></div>` : ""}
      ${rules ? `<div class="dsection"><h2>House rules</h2>${paragraphs(rules.text)}</div>` : ""}
    </div>
    <aside class="panel" id="booking" aria-label="Book this stay">
      <div class="price"><small>From</small> <b>${money(s.basePrice, s.currency, cfg.locale)}</b> <small>per night</small></div>
      <dl class="kv">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <div id="booking-app"><p class="hint">Loading availability...</p></div>
      <noscript><p class="hint">Online booking needs JavaScript. ${cfg.phone ? `Call ${esc(cfg.phone)}` : "Please contact us"} to book.</p></noscript>
    </aside>
  </div>
</div>
<script type="application/json" id="stay-data">${JSON.stringify(widgetData).replace(/</g, "\\u003c")}</script>`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "VacationRental",
    name: s.title,
    description: s.summary || undefined,
    image: s.photos.slice(0, 6).map((p) => p.url),
    address: { "@type": "PostalAddress", addressLocality: s.city, addressRegion: s.state },
    occupancy: { "@type": "QuantitativeValue", maxValue: s.sleeps },
    numberOfBedrooms: s.bedrooms,
    petsAllowed: s.pets,
    aggregateRating: s.rating ? { "@type": "AggregateRating", ratingValue: s.rating.avg, reviewCount: s.rating.total } : undefined,
  };

  return layout({
    title: `${s.title}, ${s.city} | ${cfg.brand}`,
    description: s.summary || `${s.title} in ${s.city}. Sleeps ${s.sleeps}.`,
    canonical: cfg.baseUrl ? `${cfg.baseUrl}/stays/${encodeURIComponent(s.id)}` : undefined,
    image: s.photos[0]?.url,
    jsonLd: ld,
    body,
    scripts: '<script src="/booking.js" defer></script>',
  });
}

export function errorPage(title: string, message: string): string {
  return layout({
    title: `${title} | ${site().brand}`,
    description: message,
    noindex: true,
    body: `<div class="wrap"><div class="notice big"><h1>${esc(title)}</h1><p>${esc(message)}</p><a class="btn" href="/">See all stays</a></div></div>`,
  });
}
