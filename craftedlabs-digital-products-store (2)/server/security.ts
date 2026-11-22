import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return false;
  if (/[\r\n\0]/.test(trimmed)) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function hasDangerousKeys(value: unknown, depth = 0): boolean {
  if (depth > 8 || typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousKeys(item, depth + 1));
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys((value as Record<string, unknown>)[key], depth + 1)) {
      return true;
    }
  }
  return false;
}

export function sanitizeMediaUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1000) return null;
  if (/[\r\n\0]/.test(trimmed)) return null;

  // Allow safe local relative asset/upload paths only (no // protocol-relative or .. traversal)
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.includes('..') || trimmed.includes('\\')) {
      return null;
    }
    if (trimmed.startsWith('/assets/') || trimmed.startsWith('/uploads/')) {
      return trimmed;
    }
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizeDownloadFilename(name: string, fallback = 'download.bin'): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base && base !== '.' && base !== '..' ? base.slice(0, 120) : fallback;
}

export function verifyUploadedFileSignature(filePath: string, ext: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);

    if (bytesRead <= 0) return false;
    const slice = buf.subarray(0, bytesRead);

    switch (ext) {
      case '.pdf':
        return slice.subarray(0, 5).toString('ascii') === '%PDF-';
      case '.jpg':
      case '.jpeg':
        return bytesRead >= 3 && slice[0] === 0xff && slice[1] === 0xd8 && slice[2] === 0xff;
      case '.png':
        return (
          bytesRead >= 8 &&
          slice[0] === 0x89 &&
          slice[1] === 0x50 &&
          slice[2] === 0x4e &&
          slice[3] === 0x47 &&
          slice[4] === 0x0d &&
          slice[5] === 0x0a &&
          slice[6] === 0x1a &&
          slice[7] === 0x0a
        );
      case '.webp':
        return (
          bytesRead >= 12 &&
          slice.subarray(0, 4).toString('ascii') === 'RIFF' &&
          slice.subarray(8, 12).toString('ascii') === 'WEBP'
        );
      case '.zip':
      case '.xlsx':
        return (
          bytesRead >= 4 &&
          slice[0] === 0x50 &&
          slice[1] === 0x4b &&
          ((slice[2] === 0x03 && slice[3] === 0x04) ||
            (slice[2] === 0x05 && slice[3] === 0x06))
        );
      case '.xls': {
        const isOle2 =
          bytesRead >= 8 &&
          slice[0] === 0xd0 &&
          slice[1] === 0xcf &&
          slice[2] === 0x11 &&
          slice[3] === 0xe0 &&
          slice[4] === 0xa1 &&
          slice[5] === 0xb1 &&
          slice[6] === 0x1a &&
          slice[7] === 0xe1;
        if (isOle2) return true;
        return isSafeUtf8Text(slice);
      }
      case '.csv':
      case '.md':
      case '.txt':
        return isSafeUtf8Text(slice);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function isSafeUtf8Text(slice: Buffer): boolean {
  if (slice.includes(0x00)) return false;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(slice);
    return true;
  } catch {
    return false;
  }
}

export function getClientIp(req: Request): string {
  if (process.env.VERCEL) {
    return (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  }
  return (req.socket.remoteAddress || req.ip || 'unknown').replace(/^::ffff:/, '');
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function pruneExpiredBuckets(now: number) {
  if (rateBuckets.size < 1000) return;
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}

export function createRateLimiter(options: {
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    pruneExpiredBuckets(now);

    const ip = getClientIp(req);
    const key = `${options.keyPrefix}:${ip}`;
    const existing = rateBuckets.get(key);

    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (existing.count >= options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error:
          options.message ||
          `Too many requests. Please wait ${retryAfterSec} seconds and try again.`,
      });
      return;
    }

    existing.count += 1;
    next();
  };
}

interface FailureBucket {
  failures: number;
  resetAt: number;
  lockedUntil: number;
}

const authFailures = new Map<string, FailureBucket>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 6;
const AUTH_LOCK_MS = 15 * 60 * 1000;

export function getAuthLockoutRemainingSec(ip: string, identifier?: string): number {
  const now = Date.now();
  const keys = identifier ? [`ip:${ip}`, `id:${ip}:${identifier.toLowerCase()}`] : [`ip:${ip}`];
  let maxWait = 0;

  for (const k of keys) {
    const bucket = authFailures.get(k);
    if (!bucket) continue;
    if (bucket.lockedUntil > now) {
      maxWait = Math.max(maxWait, Math.ceil((bucket.lockedUntil - now) / 1000));
    } else if (bucket.resetAt <= now) {
      authFailures.delete(k);
    }
  }
  return maxWait;
}

export function recordAuthFailure(ip: string, identifier?: string): number {
  const now = Date.now();
  if (authFailures.size > 1000) {
    for (const [k, v] of authFailures.entries()) {
      if (v.resetAt <= now && v.lockedUntil <= now) authFailures.delete(k);
    }
  }

  const keys = identifier ? [`ip:${ip}`, `id:${ip}:${identifier.toLowerCase()}`] : [`ip:${ip}`];
  let lockedSec = 0;

  for (const k of keys) {
    const existing = authFailures.get(k);
    if (!existing || (existing.resetAt <= now && existing.lockedUntil <= now)) {
      authFailures.set(k, {
        failures: 1,
        resetAt: now + AUTH_WINDOW_MS,
        lockedUntil: 0,
      });
      continue;
    }

    existing.failures += 1;
    const limit = k.startsWith('ip:') ? AUTH_MAX_FAILURES * 2 : AUTH_MAX_FAILURES;
    if (existing.failures >= limit) {
      existing.lockedUntil = now + AUTH_LOCK_MS;
      lockedSec = Math.max(lockedSec, Math.ceil(AUTH_LOCK_MS / 1000));
    }
  }

  return lockedSec;
}

export function clearAuthFailures(ip: string, identifier?: string): void {
  authFailures.delete(`ip:${ip}`);
  if (identifier) {
    authFailures.delete(`id:${ip}:${identifier.toLowerCase()}`);
  }
}

export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  if (req.path.startsWith('/api/admin') || req.path.startsWith('/api/orders/my')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

export function strictOriginGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (
    req.method !== 'POST' &&
    req.method !== 'PUT' &&
    req.method !== 'PATCH' &&
    req.method !== 'DELETE'
  ) {
    next();
    return;
  }

  const originHeader = String(req.headers.origin || '').trim();
  if (!originHeader) {
    next();
    return;
  }

  try {
    const originHost = new URL(originHeader).host.toLowerCase();
    const expectedHost = String(
      req.headers['x-forwarded-host'] || req.headers.host || ''
    )
      .split(',')[0]
      .trim()
      .toLowerCase();

    if (expectedHost && originHost === expectedHost) {
      next();
      return;
    }

    // Allow local dev hostnames matching port
    const expectedHostname = expectedHost.split(':')[0];
    const originHostname = originHost.split(':')[0];
    if (
      (expectedHostname === 'localhost' || expectedHostname === '127.0.0.1' || expectedHostname === '0.0.0.0') &&
      (originHostname === 'localhost' || originHostname === '127.0.0.1')
    ) {
      next();
      return;
    }

    res.status(403).json({ error: 'Cross-origin request blocked.' });
  } catch {
    res.status(403).json({ error: 'Invalid request origin.' });
  }
}

export function rejectDangerousJsonMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.body !== undefined && hasDangerousKeys(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  next();
}
