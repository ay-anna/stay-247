import { GuestyError } from "./guesty";
import type { Res } from "./types";

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "bad_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(status: number, data: unknown, headers: Record<string, string> = {}): Res {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(data),
  };
}

export function htmlRes(status: number, body: string, headers: Record<string, string> = {}): Res {
  return { status, headers: { "content-type": "text/html; charset=utf-8", ...headers }, body };
}

/** Turns any error into a response a guest can read. Details go to the server log, not the browser. */
export function failJson(e: unknown): Res {
  const { status, message, code } = describe(e);
  return json(status, { error: { message, code } });
}

export function describe(e: unknown): { status: number; message: string; code: string } {
  if (e instanceof HttpError) return { status: e.status, message: e.message, code: e.code };
  if (e instanceof GuestyError) {
    console.error(`[guesty] ${e.status} ${e.code ?? ""} ${e.message}${e.requestId ? ` requestId=${e.requestId}` : ""}`);
    if (e.code === "config") return { status: 500, message: "The booking system is not set up yet.", code: "config" };
    if (e.status === 404) return { status: 404, message: "We could not find that.", code: "not_found" };
    if (e.status === 400 || e.status === 422) return { status: 400, message: e.message || "That request was not accepted.", code: e.code ?? "rejected" };
    if (e.status === 429 || e.status === 503) return { status: 503, message: "We are busy right now. Please try again in a moment.", code: "busy" };
    return { status: 502, message: "We could not reach the booking system. Please try again shortly.", code: "upstream" };
  }
  console.error("[server]", e);
  return { status: 500, message: "Something went wrong on our side.", code: "internal" };
}

export const isId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(s);
export const isEmail = (s: unknown): s is string => typeof s === "string" && s.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function text(v: unknown, max: number, field: string, required = true): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s && required) throw new HttpError(400, `Please enter ${field}.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long.`);
  return s;
}

export function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new HttpError(400, "That request was not understood.");
}
