function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/** Everything a site owner may want to change lives in environment variables, so no code edits are needed. */
export function site() {
  return {
    brand: env("SITE_NAME", "Stay Direct"),
    heroTitle: env("SITE_HEADLINE", "Book direct and save"),
    tagline: env("SITE_TAGLINE", "Handpicked holiday homes, with the owner a message away."),
    phone: env("SITE_PHONE"),
    email: env("SITE_EMAIL"),
    baseUrl: env("SITE_URL").replace(/\/$/, ""),
    timeZone: env("SITE_TIMEZONE", "Australia/Sydney"),
    locale: env("SITE_LOCALE", "en-AU"),
    termsUrl: env("SITE_TERMS_URL"),
    privacyUrl: env("SITE_PRIVACY_URL"),
  };
}

export function isMock(): boolean {
  return process.env.GUESTY_MOCK === "1";
}
