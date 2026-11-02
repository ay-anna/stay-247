/**
 * Local preview server. Run with: npm run dev
 * Uses pretend properties unless Guesty credentials are set (in the environment or in a .env file).
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import * as routes from "../lib/routes";
import type { Ctx, Res } from "../lib/types";

// A tiny .env reader so local runs need no extra packages.
const envFile = join(__dirname, "..", ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.GUESTY_CLIENT_ID && process.env.GUESTY_MOCK === undefined) process.env.GUESTY_MOCK = "1";

const publicDir = join(__dirname, "..", "public");
const types: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const apiRoutes: Record<string, (ctx: Ctx) => Promise<Res>> = {
  "/api/calendar": routes.calendar,
  "/api/quote": routes.quote,
  "/api/payment": routes.payment,
  "/api/book": routes.book,
  "/api/verify": routes.verify,
};

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    if (!(k in query)) query[k] = v;
  });
  const ctx: Ctx = { method: req.method ?? "GET", path: url.pathname, query, body: req.method === "POST" ? await readBody(req) : undefined, host: req.headers.host };

  let out: Res | null = null;
  const stayMatch = /^\/stays\/([^/]+)\/?$/.exec(url.pathname);
  if (url.pathname === "/") out = await routes.home(ctx);
  else if (stayMatch) out = await routes.stay({ ...ctx, query: { ...query, id: decodeURIComponent(stayMatch[1]) } });
  else if (url.pathname === "/sitemap.xml") out = await routes.sitemap(ctx);
  else if (apiRoutes[url.pathname]) out = await apiRoutes[url.pathname](ctx);

  if (!out) {
    const file = normalize(join(publicDir, url.pathname));
    if (file.startsWith(publicDir) && existsSync(file) && extname(file)) {
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
      return;
    }
    out = { status: 404, headers: { "content-type": "text/plain" }, body: "Not found" };
  }
  res.writeHead(out.status, out.headers);
  res.end(out.body);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  const mode = process.env.GUESTY_MOCK === "1" ? "demo data" : "live Guesty data";
  console.log(`Stay Direct is running at http://localhost:${port} (${mode})`);
});
