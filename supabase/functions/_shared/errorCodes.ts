// Canonical structured error codes for all edge functions.
//
// Response shape (machine-readable + back-compat with string `error` consumers):
//
//   {
//     "code":    "INVALID_INPUT",
//     "error":   "INVALID_INPUT",   // legacy: many old callers read `error` as the code
//     "message": "human-readable message",
//     ...extra
//   }
//
// Frontend should switch on `code`. `error` is kept until all callers migrate.

import { corsHeaders } from './cors.ts';

export type ErrorCode =
  | 'INVALID_INPUT'        // 400 – schema / validation / malformed body
  | 'AUTH_REQUIRED'        // 401 – no JWT
  | 'AUTH_FAILED'          // 401 – JWT invalid / expired
  | 'FORBIDDEN'            // 403 – authenticated but not allowed
  | 'NOT_FOUND'            // 404
  | 'METHOD_NOT_ALLOWED'   // 405
  | 'QUOTA_EXCEEDED'       // 429 – business quota
  | 'RATE_LIMITED'         // 429 – generic rate limiting
  | 'UPSTREAM_ERROR'       // 502 – external API / RPC failed
  | 'TIMEOUT'              // 504
  | 'INTERNAL_ERROR';      // 500 – uncaught / unknown

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  AUTH_REQUIRED: 401,
  AUTH_FAILED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return DEFAULT_STATUS[code] ?? 500;
}

export interface CodedErrorBody {
  code: ErrorCode;
  error: ErrorCode; // back-compat alias
  message: string;
  [k: string]: unknown;
}

export function codedErrorBody(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): CodedErrorBody {
  return { code, error: code, message, ...(extra || {}) };
}

/** Build a structured-error Response with CORS headers preserved. */
export function codedErrorResponse(
  code: ErrorCode,
  message: string,
  opts: { status?: number; extra?: Record<string, unknown>; headers?: HeadersInit } = {},
): Response {
  return new Response(JSON.stringify(codedErrorBody(code, message, opts.extra)), {
    status: opts.status ?? httpStatusFor(code),
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
