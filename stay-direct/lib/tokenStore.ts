/**
 * Guesty only lets an application renew its access token a few times per day, and each token lasts 24 hours.
 * On Vercel every cold start is a new process, so the token has to live somewhere shared. This file offers two
 * stores: memory (fine for local use) and Upstash Redis over its REST API (use this on Vercel).
 */
export interface TokenStore {
  get(): Promise<string | null>;
  set(value: string, ttlSeconds: number): Promise<void>;
  del(): Promise<void>;
  /** Try to become the one request that fetches a new token. */
  lock(): Promise<boolean>;
  unlock(): Promise<void>;
}

const KEY = "stay-direct:guesty-token";
const LOCK = "stay-direct:guesty-token-lock";

export function memoryStore(): TokenStore {
  let value: { v: string; exp: number } | null = null;
  let locked = false;
  return {
    async get() {
      return value && value.exp > Date.now() ? value.v : null;
    },
    async set(v, ttl) {
      value = { v, exp: Date.now() + ttl * 1000 };
    },
    async del() {
      value = null;
    },
    async lock() {
      if (locked) return false;
      locked = true;
      return true;
    },
    async unlock() {
      locked = false;
    },
  };
}

export function upstashStore(url: string, token: string): TokenStore {
  async function cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(url.replace(/\/$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Token store returned ${res.status}`);
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) throw new Error(`Token store error: ${data.error}`);
    return data.result ?? null;
  }
  return {
    async get() {
      const r = await cmd(["GET", KEY]);
      return typeof r === "string" ? r : null;
    },
    async set(v, ttl) {
      await cmd(["SET", KEY, v, "EX", Math.max(60, Math.floor(ttl))]);
    },
    async del() {
      await cmd(["DEL", KEY]);
    },
    async lock() {
      const r = await cmd(["SET", LOCK, "1", "NX", "EX", 30]);
      return r === "OK";
    },
    async unlock() {
      await cmd(["DEL", LOCK]);
    },
  };
}

let shared: TokenStore | null = null;

export function getStore(): TokenStore {
  if (shared) return shared;
  // Vercel's Upstash integration sets KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  shared = url && tok ? upstashStore(url, tok) : memoryStore();
  return shared;
}

export function resetStoreForTests(): void {
  shared = null;
}

export function usingSharedStore(): boolean {
  return Boolean((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
}
