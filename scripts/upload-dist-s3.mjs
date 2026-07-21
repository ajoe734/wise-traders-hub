#!/usr/bin/env node
/**
 * Upload dist/ to S3 with exponential backoff retry until success or timeout.
 *
 * Env:
 *   S3_BUCKET             (required) target bucket
 *   S3_PREFIX             (optional) key prefix, default ""
 *   S3_REGION             (optional) default "ap-northeast-1"
 *   AWS_ACCESS_KEY_ID     (required)
 *   AWS_SECRET_ACCESS_KEY (required)
 *   DIST_DIR              (optional) default "dist"
 *   UPLOAD_TIMEOUT_MS     (optional) overall wall-clock budget, default 1800000 (30 min)
 *   UPLOAD_MAX_ATTEMPTS   (optional) per-file cap, default 8
 *   UPLOAD_BASE_DELAY_MS  (optional) initial backoff, default 1000
 *   UPLOAD_MAX_DELAY_MS   (optional) cap, default 60000
 *   UPLOAD_CONCURRENCY    (optional) parallel uploads, default 8
 *
 * Retry policy: exponential backoff with full jitter, retries on:
 *   - Network errors (ECONNRESET/ETIMEDOUT/EAI_AGAIN/EPIPE)
 *   - HTTP 5xx / 429
 *   - S3 InternalError / SlowDown / RequestTimeout / ServiceUnavailable
 * Aborts early if wall-clock exceeds UPLOAD_TIMEOUT_MS.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep, posix } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const {
  S3_BUCKET,
  S3_PREFIX = "",
  S3_REGION = "ap-northeast-1",
  DIST_DIR = "dist",
  UPLOAD_TIMEOUT_MS = "1800000",
  UPLOAD_MAX_ATTEMPTS = "8",
  UPLOAD_BASE_DELAY_MS = "1000",
  UPLOAD_MAX_DELAY_MS = "60000",
  UPLOAD_CONCURRENCY = "8",
} = process.env;

if (!S3_BUCKET) {
  console.error("[upload-dist-s3] Missing S3_BUCKET; skipping upload.");
  process.exit(0);
}

const budgetMs = Number(UPLOAD_TIMEOUT_MS);
const maxAttempts = Number(UPLOAD_MAX_ATTEMPTS);
const baseDelay = Number(UPLOAD_BASE_DELAY_MS);
const maxDelay = Number(UPLOAD_MAX_DELAY_MS);
const concurrency = Math.max(1, Number(UPLOAD_CONCURRENCY));
const deadline = Date.now() + budgetMs;

const client = new S3Client({ region: S3_REGION, maxAttempts: 1 });

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".map": "application/json",
};

function contentTypeFor(path) {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && CONTENT_TYPES[path.slice(dot)]) || "application/octet-stream";
}

function isRetriable(err) {
  if (!err) return false;
  const code = err.Code || err.code || err.name;
  const status = err.$metadata?.httpStatusCode ?? err.statusCode;
  if (status && (status >= 500 || status === 429)) return true;
  if (typeof code === "string") {
    if (["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "ENOTFOUND", "ECONNREFUSED"].includes(code)) return true;
    if (["InternalError", "SlowDown", "RequestTimeout", "ServiceUnavailable", "ThrottlingException", "TimeoutError"].includes(code)) return true;
  }
  return false;
}

function backoffDelay(attempt) {
  const exp = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
  return Math.floor(Math.random() * exp); // full jitter
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

async function uploadOne(absPath, rootDir) {
  const rel = relative(rootDir, absPath).split(sep).join(posix.sep);
  const key = S3_PREFIX ? `${S3_PREFIX.replace(/\/+$/, "")}/${rel}` : rel;
  const body = await readFile(absPath);
  const md5 = createHash("md5").update(body).digest("base64");
  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentTypeFor(rel),
    ContentMD5: md5,
    CacheControl: /\.(html|xml|txt)$/i.test(rel) ? "no-cache" : "public, max-age=31536000, immutable",
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() >= deadline) {
      throw new Error(`Overall timeout exceeded before uploading ${key}`);
    }
    try {
      await client.send(cmd);
      if (attempt > 1) console.log(`[upload-dist-s3] ok ${key} (attempt ${attempt})`);
      return;
    } catch (err) {
      const retriable = isRetriable(err);
      const remaining = deadline - Date.now();
      if (!retriable || attempt === maxAttempts || remaining <= 0) {
        console.error(`[upload-dist-s3] FAIL ${key} attempt=${attempt} retriable=${retriable}:`, err.message || err);
        throw err;
      }
      const delay = Math.min(backoffDelay(attempt), Math.max(0, remaining - 100));
      console.warn(
        `[upload-dist-s3] retry ${key} attempt=${attempt} in ${delay}ms (${err.Code || err.code || err.name}: ${err.message || ""})`,
      );
      await sleep(delay);
    }
  }
}

async function main() {
  const st = await stat(DIST_DIR).catch(() => null);
  if (!st?.isDirectory()) {
    console.error(`[upload-dist-s3] ${DIST_DIR} is not a directory`);
    process.exit(1);
  }
  const files = [];
  for await (const f of walk(DIST_DIR)) files.push(f);
  console.log(`[upload-dist-s3] uploading ${files.length} files → s3://${S3_BUCKET}/${S3_PREFIX} (budget ${budgetMs}ms, concurrency ${concurrency})`);

  let idx = 0;
  let failed = null;
  async function worker() {
    while (!failed) {
      const i = idx++;
      if (i >= files.length) return;
      try {
        await uploadOne(files[i], DIST_DIR);
      } catch (err) {
        failed = err;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failed) {
    console.error(`[upload-dist-s3] aborted: ${failed.message || failed}`);
    process.exit(1);
  }
  console.log(`[upload-dist-s3] done in ${Date.now() - (deadline - budgetMs)}ms`);
}

main().catch((err) => {
  console.error("[upload-dist-s3] fatal:", err);
  process.exit(1);
});
