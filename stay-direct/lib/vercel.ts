import type { Ctx, Res } from "./types";

/**
 * The only file that knows about Vercel's request object. Every route is a plain function from Ctx to Res,
 * so the same code runs on Vercel, in the local dev server and in tests.
 */
interface VercelReq {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}
interface VercelRes {
  status(code: number): VercelRes;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

export function vercel(route: (ctx: Ctx) => Promise<Res>) {
  return async function handler(req: VercelReq, res: VercelRes): Promise<void> {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) {
      const first = Array.isArray(v) ? v[0] : v;
      if (typeof first === "string") query[k] = first;
    }
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = undefined;
      }
    }
    const host = Array.isArray(req.headers?.host) ? req.headers?.host[0] : req.headers?.host;
    const out = await route({ method: req.method ?? "GET", path: (req.url ?? "").split("?")[0], query, body, host });
    res.status(out.status);
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.send(out.body);
  };
}
