import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer from 'multer';
import {
  db,
  getStorefrontSettings,
  mapProductRow,
  PRIVATE_FILES_DIR,
  PUBLIC_UPLOADS_DIR,
  type DbProductRow,
} from './db.ts';
import {
  claimFirstAdmin,
  getClaimedAdminRow,
  getEnvAdminPasscode,
  isAllowedOwnerEmail,
  isOwnerAutoAuthorized,
  safeEqualStrings,
  signAdminToken,
  verifyAdminPassword,
  verifyAdminToken,
  verifyAdminTokenPayload,
  verifyFirebaseIdToken,
  type VerifiedFirebaseUser,
} from './auth.ts';
import {
  clearAuthFailures,
  createRateLimiter,
  getAuthLockoutRemainingSec,
  getClientIp,
  isPlainObject,
  isValidEmail,
  recordAuthFailure,
  rejectDangerousJsonMiddleware,
  sanitizeDownloadFilename,
  sanitizeMediaUrl,
  securityHeadersMiddleware,
  strictOriginGuard,
  verifyUploadedFileSignature,
} from './security.ts';

interface AuthedRequest extends Request {
  firebaseUser?: VerifiedFirebaseUser;
}

function extractBearer(req: Request): string {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

async function requireFirebaseAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const verified = await verifyFirebaseIdToken(token);
  if (!verified) {
    res.status(401).json({ error: 'Invalid or expired Firebase session.' });
    return;
  }
  req.firebaseUser = verified;
  next();
}

async function requireAdminSession(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const adminToken = String(req.headers['x-admin-token'] || '').trim();
  if (adminToken) {
    const payload = verifyAdminTokenPayload(adminToken);
    if (payload) {
      req.firebaseUser = {
        uid: payload.uid,
        email: payload.email,
        emailVerified: true,
      };
      next();
      return;
    }
  }

  const bearer = extractBearer(req);
  if (!bearer) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const verified = await verifyFirebaseIdToken(bearer);
  if (!verified) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  if (!isAllowedOwnerEmail(verified.email)) {
    res
      .status(403)
      .json({ error: 'Admin access is restricted to the store owner only.' });
    return;
  }
  if (
    isOwnerAutoAuthorized(verified) ||
    (adminToken && verifyAdminToken(adminToken, verified.uid))
  ) {
    req.firebaseUser = verified;
    next();
    return;
  }
  res.status(403).json({ error: 'Admin authorization required.' });
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function safeResolveWithin(baseDir: string, fileName: string): string | null {
  const cleanName = path.basename(fileName);
  if (!cleanName || cleanName === '.' || cleanName === '..') return null;
  const resolved = path.resolve(baseDir, cleanName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }
  return resolved;
}

class ClientValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const deliverableUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PRIVATE_FILES_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const id = crypto.randomUUID();
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set([
      '.pdf',
      '.xlsx',
      '.xls',
      '.csv',
      '.md',
      '.txt',
      '.zip',
    ]);
    if (!allowed.has(ext)) {
      cb(
        new ClientValidationError(
          'Unsupported deliverable file type. Upload PDF, XLSX, CSV, MD, TXT, or ZIP.'
        )
      );
      return;
    }
    cb(null, true);
  },
});

const previewUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PUBLIC_UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const id = crypto.randomUUID();
      cb(null, `preview-${id}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    if (!allowed.has(ext)) {
      cb(
        new ClientValidationError(
          'Unsupported preview image type. Upload JPG, PNG, or WEBP.'
        )
      );
      return;
    }
    cb(null, true);
  },
});

const publicWriteLimiter = createRateLimiter({
  keyPrefix: 'pub-write',
  windowMs: 10 * 60 * 1000,
  maxRequests: 30,
  message: 'Too many submissions. Please wait a few minutes and try again.',
});

const couponValidateLimiter = createRateLimiter({
  keyPrefix: 'coupon-check',
  windowMs: 5 * 60 * 1000,
  maxRequests: 25,
  message: 'Too many code attempts. Please wait a few minutes.',
});

const downloadLimiter = createRateLimiter({
  keyPrefix: 'download',
  windowMs: 5 * 60 * 1000,
  maxRequests: 40,
  message: 'Too many download requests. Please wait a few minutes.',
});

const authEndpointLimiter = createRateLimiter({
  keyPrefix: 'auth-check',
  windowMs: 5 * 60 * 1000,
  maxRequests: 45,
});

const adminWriteLimiter = createRateLimiter({
  keyPrefix: 'admin-write',
  windowMs: 5 * 60 * 1000,
  maxRequests: 120,
});

export const app = express();
app.disable('x-powered-by');
if (process.env.VERCEL) {
  app.set('trust proxy', 1);
}

app.use(securityHeadersMiddleware);
app.use(express.json({ limit: '512kb' }));
app.use(rejectDangerousJsonMiddleware);
app.use('/api/admin', strictOriginGuard);

// Public uploaded preview images with strict path confinement and image-only content types
const ALLOWED_UPLOAD_FILENAME = /^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/i;
const UPLOAD_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

app.get('/uploads/:filename', (req, res) => {
  const filename = String(req.params.filename || '');
  if (!ALLOWED_UPLOAD_FILENAME.test(filename)) {
    res.status(404).send('Not found');
    return;
  }
  const resolved = safeResolveWithin(PUBLIC_UPLOADS_DIR, filename);
  if (!resolved || !fs.existsSync(resolved)) {
    res.status(404).send('Not found');
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  res.setHeader('Content-Type', UPLOAD_MIME_BY_EXT[ext] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(resolved);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: 'demo-payment-backend-enabled' });
});

// Public catalog & editorial articles
app.get('/api/catalog', (_req, res) => {
  const prodRows = db
    .prepare('SELECT * FROM products ORDER BY featured DESC, created_at DESC')
    .all() as unknown as DbProductRow[];

  const blogRows = db
    .prepare('SELECT * FROM blog_articles ORDER BY rowid DESC')
    .all() as unknown as {
      id: string;
      slug: string;
      category: string;
      title: string;
      excerpt: string;
      published_at: string;
      read_time: string;
      image: string;
      image_alt: string;
      body_json: string;
    }[];

  res.json({
    products: prodRows.map(mapProductRow),
    blogArticles: blogRows.map((b) => ({
      id: b.id,
      slug: b.slug,
      category: b.category,
      title: b.title,
      excerpt: b.excerpt,
      publishedAt: b.published_at,
      readTime: b.read_time,
      image: b.image,
      imageAlt: b.image_alt,
      body: JSON.parse(b.body_json) as string[],
    })),
    storefrontSettings: getStorefrontSettings(),
  });
});

// Newsletter & Free Resource lead capture
app.post('/api/subscribers', publicWriteLimiter, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const { firstName, email, consentGiven, source, resourceName } = req.body as {
    firstName?: string;
    email?: string;
    consentGiven?: boolean;
    source?: string;
    resourceName?: string;
  };

  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (consentGiven !== true) {
    res.status(400).json({ error: 'Explicit email consent is required.' });
    return;
  }

  const cleanSource = source === 'free-resource' ? 'free-resource' : 'newsletter';
  const id = `sub-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO subscribers (id, first_name, email, consent_given, source, resource_name, created_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `).run(
    id,
    firstName ? String(firstName).trim().slice(0, 80) : null,
    cleanEmail,
    cleanSource,
    resourceName ? String(resourceName).trim().slice(0, 120) : null,
    createdAt
  );

  res.status(201).json({ ok: true, id });
});

// About page contact message persistence
app.post('/api/contact', publicWriteLimiter, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const { name, email, message } = req.body as {
    name?: string;
    email?: string;
    message?: string;
  };
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanMsg = String(message || '').trim();
  const cleanName = String(name || '').trim();

  if (!cleanName || !isValidEmail(cleanEmail) || !cleanMsg) {
    res.status(400).json({ error: 'Name, valid email, and message are required.' });
    return;
  }

  const id = `msg-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO contact_messages (id, name, email, message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    cleanName.slice(0, 120),
    cleanEmail,
    cleanMsg.slice(0, 2000),
    new Date().toISOString()
  );

  res.status(201).json({ ok: true, id });
});

// Validate discount code server-side
app.post('/api/discounts/validate', couponValidateLimiter, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ valid: false, error: 'Invalid request payload.' });
    return;
  }
  const code = String((req.body as { code?: string }).code || '')
    .trim()
    .toUpperCase()
    .slice(0, 32);
  if (!code || !/^[A-Z0-9_-]+$/.test(code)) {
    res.status(400).json({ valid: false, error: 'Enter a valid discount code.' });
    return;
  }

  const row = db
    .prepare('SELECT code, percent_off, active, description FROM discount_codes WHERE code = ?')
    .get(code) as
    | { code: string; percent_off: number; active: number; description: string }
    | undefined;

  if (!row || row.active !== 1) {
    res.json({ valid: false, error: 'Invalid or inactive discount code.' });
    return;
  }

  res.json({
    valid: true,
    code: row.code,
    percentOff: Number(row.percent_off),
    description: row.description,
  });
});

// Demo Checkout Order Creation (authoritative backend pricing)
app.post('/api/orders', publicWriteLimiter, async (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const {
    customerEmail,
    items,
    discountCode,
    paymentMethod,
    paymentProviderName,
  } = req.body as {
    customerEmail?: string;
    items?: { productId: string; qty: number }[];
    discountCode?: string;
    paymentMethod?: string;
    paymentProviderName?: string;
  };

  const cleanEmail = String(customerEmail || '').trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Valid customer email is required.' });
    return;
  }

  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    res.status(400).json({ error: 'Cart must contain between 1 and 50 items.' });
    return;
  }

  // Optional verified Firebase user association
  let userId: string | null = null;
  const bearer = extractBearer(req);
  if (bearer) {
    const verified = await verifyFirebaseIdToken(bearer);
    if (verified) userId = verified.uid;
  }

  const orderItems: {
    productId: string;
    title: string;
    productType: string;
    unitPrice: number;
    qty: number;
  }[] = [];
  let subtotal = 0;

  for (const entry of items) {
    if (!isPlainObject(entry)) {
      res.status(400).json({ error: 'Invalid cart item.' });
      return;
    }
    const rawQty = Number(entry.qty);
    const qty = Number.isFinite(rawQty)
      ? Math.max(1, Math.min(20, Math.floor(rawQty)))
      : 1;
    const productId = String(entry.productId || '').trim().slice(0, 80);
    const prod = db
      .prepare('SELECT id, title, product_type, price FROM products WHERE id = ?')
      .get(productId) as
      | { id: string; title: string; product_type: string; price: number }
      | undefined;
    if (!prod) {
      res.status(400).json({ error: 'One or more products are no longer available.' });
      return;
    }
    const unitPrice = Number(prod.price);
    subtotal += unitPrice * qty;
    orderItems.push({
      productId: prod.id,
      title: prod.title,
      productType: prod.product_type,
      unitPrice,
      qty,
    });
  }

  subtotal = Number(subtotal.toFixed(2));
  let appliedCode: string | null = null;
  let discountAmount = 0;

  if (discountCode) {
    const normalized = String(discountCode).trim().toUpperCase().slice(0, 32);
    const coupon = db
      .prepare('SELECT code, percent_off, active FROM discount_codes WHERE code = ?')
      .get(normalized) as
      | { code: string; percent_off: number; active: number }
      | undefined;
    if (coupon && coupon.active === 1) {
      appliedCode = coupon.code;
      discountAmount = Number(((subtotal * Number(coupon.percent_off)) / 100).toFixed(2));
    }
  }

  const total = Math.max(0, Number((subtotal - discountAmount).toFixed(2)));
  const orderId = `DEMO-CL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const receiptToken = crypto.randomBytes(24).toString('hex');
  const createdAt = new Date().toISOString();

  const allowedMethods = new Set(['demo-card', 'demo-momo', 'demo-mor']);
  const safeMethod = allowedMethods.has(String(paymentMethod || ''))
    ? String(paymentMethod)
    : 'demo-card';
  const safeProvider = String(paymentProviderName || 'Demo Test Checkout').trim().slice(0, 120);

  db.prepare(`
    INSERT INTO orders (
      id, created_at, customer_email, user_id, items_json, subtotal,
      discount_code, discount_amount, total, currency, payment_method,
      payment_provider_name, status, download_count, receipt_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, 'Demo Confirmed', 0, ?)
  `).run(
    orderId,
    createdAt,
    cleanEmail,
    userId,
    JSON.stringify(orderItems),
    subtotal,
    appliedCode,
    discountAmount,
    total,
    safeMethod,
    safeProvider,
    receiptToken
  );

  res.status(201).json({
    order: {
      id: orderId,
      createdAt,
      customerEmail: cleanEmail,
      userId: userId ?? undefined,
      items: orderItems,
      subtotal,
      discountCode: appliedCode ?? undefined,
      discountAmount,
      total,
      currency: 'USD',
      paymentMethod: safeMethod,
      paymentProviderName: safeProvider,
      status: 'Demo Confirmed',
      downloadCount: 0,
      receiptToken,
    },
  });
});

// Signed-in customer order history (ownership verified; email match requires verified email)
app.get(
  '/api/orders/my',
  authEndpointLimiter,
  requireFirebaseAuth,
  (req: AuthedRequest, res) => {
    const user = req.firebaseUser!;
    const rows = db
      .prepare(
        'SELECT * FROM orders WHERE user_id = ? OR (? = 1 AND LOWER(customer_email) = ?) ORDER BY created_at DESC'
      )
      .all(
        user.uid,
        user.emailVerified ? 1 : 0,
        user.email.toLowerCase()
      ) as unknown as {
        id: string;
        created_at: string;
        customer_email: string;
        user_id: string | null;
        items_json: string;
        subtotal: number;
        discount_code: string | null;
        discount_amount: number;
        total: number;
        currency: string;
        payment_method: string;
        payment_provider_name: string;
        status: string;
        download_count: number;
        last_downloaded_at: string | null;
        receipt_token: string;
      }[];

    res.json({
      orders: rows.map((o) => ({
        id: o.id,
        createdAt: o.created_at,
        customerEmail: o.customer_email,
        userId: o.user_id ?? undefined,
        items: JSON.parse(o.items_json),
        subtotal: Number(o.subtotal),
        discountCode: o.discount_code ?? undefined,
        discountAmount: Number(o.discount_amount),
        total: Number(o.total),
        currency: o.currency,
        paymentMethod: o.payment_method,
        paymentProviderName: o.payment_provider_name,
        status: o.status,
        downloadCount: Number(o.download_count),
        lastDownloadedAt: o.last_downloaded_at ?? undefined,
        receiptToken: o.receipt_token,
      })),
    });
  }
);

// Gated digital file delivery (timing-safe receipt check + verified ownership)
app.get('/api/downloads/:orderId/:productId', downloadLimiter, async (req, res) => {
  const orderId = String(req.params.orderId || '').slice(0, 64);
  const productId = String(req.params.productId || '').slice(0, 80);
  const receipt = String(req.query.receipt || '').slice(0, 128);
  const bearer = extractBearer(req);

  const order = db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .get(orderId) as
    | {
        id: string;
        customer_email: string;
        user_id: string | null;
        items_json: string;
        receipt_token: string;
      }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }

  let authorized = false;
  if (receipt && safeEqualStrings(receipt, order.receipt_token)) {
    authorized = true;
  } else if (bearer) {
    const verified = await verifyFirebaseIdToken(bearer);
    if (
      verified &&
      (order.user_id === verified.uid ||
        (verified.emailVerified &&
          order.customer_email.toLowerCase() === verified.email.toLowerCase()))
    ) {
      authorized = true;
    }
  }

  if (!authorized) {
    res.status(403).json({ error: 'Unauthorized download access.' });
    return;
  }

  const items = JSON.parse(order.items_json) as { productId: string }[];
  if (!items.some((i) => i.productId === productId)) {
    res.status(403).json({ error: 'Product not included in this order.' });
    return;
  }

  const prod = db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(productId) as unknown as DbProductRow | undefined;

  if (!prod) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  db.prepare(
    'UPDATE orders SET download_count = download_count + 1, last_downloaded_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), orderId);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (prod.deliverable_file_key) {
    const resolved = safeResolveWithin(PRIVATE_FILES_DIR, prod.deliverable_file_key);
    if (resolved && fs.existsSync(resolved)) {
      const downloadName = sanitizeDownloadFilename(
        prod.deliverable_file_name || `${prod.slug}.pdf`,
        `${prod.slug}.pdf`
      );
      res.download(resolved, downloadName);
      return;
    }
  }

  const mapped = mapProductRow(prod);
  const content = [
    `# ${mapped.title} — CraftedLabs Digital Starter Package`,
    `Order Reference: ${order.id}`,
    `Licensed To: ${order.customer_email}`,
    `Product Type: ${mapped.productType}`,
    `Delivered: ${new Date().toISOString()}`,
    '',
    '## Overview',
    mapped.subtitle,
    '',
    mapped.fullDesc,
    '',
    '## Included Modules',
    ...mapped.whatsIncluded.map((w, idx) => `${idx + 1}. ${w}`),
    '',
    '## Setup Summary',
    mapped.deliverableSummary,
  ].join('\n');

  const fallbackFilename = sanitizeDownloadFilename(
    `${mapped.slug}-craftedlabs-package.md`,
    'craftedlabs-package.md'
  );
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fallbackFilename}"`
  );
  res.send(content);
});

// Role check for auth redirect (server-verified via Firebase JWT)
app.get(
  '/api/auth/me',
  authEndpointLimiter,
  requireFirebaseAuth,
  (req: AuthedRequest, res) => {
    const user = req.firebaseUser!;
    const isOwner = isAllowedOwnerEmail(user.email);
    res.json({
      role: isOwner ? 'admin' : 'customer',
      emailVerified: user.emailVerified,
      autoPassAdmin: isOwnerAutoAuthorized(user),
    });
  }
);

// ========================
// ADMIN AUTHENTICATION API
// ========================
app.post('/api/admin/login', (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }

  const { email, password } = req.body as { email?: string; password?: string };
  const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 254);
  const cleanPassword = String(password || '');
  const ip = getClientIp(req);

  const lockSec = getAuthLockoutRemainingSec(ip, cleanEmail);
  if (lockSec > 0) {
    res.setHeader('Retry-After', String(lockSec));
    res.status(429).json({
      error: `Too many failed sign-in attempts. Locked for ${Math.ceil(
        lockSec / 60
      )} minute(s).`,
    });
    return;
  }

  if (!isValidEmail(cleanEmail) || !cleanPassword || cleanPassword.length > 256) {
    res.status(400).json({ error: 'Valid email and password are required.' });
    return;
  }

  if (!isAllowedOwnerEmail(cleanEmail) || !verifyAdminPassword(cleanPassword)) {
    const triggeredLockSec = recordAuthFailure(ip, cleanEmail);
    if (triggeredLockSec > 0) {
      res.setHeader('Retry-After', String(triggeredLockSec));
      res.status(429).json({
        error: 'Too many failed sign-in attempts. Please try again in 15 minutes.',
      });
      return;
    }
    res.status(401).json({ error: 'Invalid admin credentials.' });
    return;
  }

  clearAuthFailures(ip, cleanEmail);
  const adminToken = signAdminToken('backend-admin', cleanEmail);
  res.json({ adminToken, email: cleanEmail, role: 'admin' });
});

app.get('/api/admin/status', authEndpointLimiter, async (req: AuthedRequest, res) => {
  const adminHeader = String(req.headers['x-admin-token'] || '').trim();
  const envPassConfigured = getEnvAdminPasscode().length > 0;
  const claimed = getClaimedAdminRow();
  const hasClaimedAdmin = Boolean(claimed?.password_hash);

  if (adminHeader) {
    const tokenPayload = verifyAdminTokenPayload(adminHeader);
    if (tokenPayload) {
      res.json({
        isAuthorized: true,
        ownerOnlyDenied: false,
        envPassConfigured,
        hasClaimedAdmin: true,
        requiresSetup: false,
        emailVerified: true,
      });
      return;
    }
  }

  const bearer = extractBearer(req);
  if (!bearer) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const user = await verifyFirebaseIdToken(bearer);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired Firebase session.' });
    return;
  }

  const isOwner = isAllowedOwnerEmail(user.email);
  if (!isOwner) {
    res.json({
      isAuthorized: false,
      ownerOnlyDenied: true,
      envPassConfigured,
      hasClaimedAdmin,
      requiresSetup: false,
      emailVerified: user.emailVerified,
    });
    return;
  }

  const autoAuthorized = isOwnerAutoAuthorized(user);
  const isAuthorized =
    autoAuthorized ||
    (adminHeader.length > 0 && verifyAdminToken(adminHeader, user.uid));

  res.json({
    isAuthorized,
    ownerOnlyDenied: false,
    envPassConfigured,
    hasClaimedAdmin,
    requiresSetup: !envPassConfigured && !hasClaimedAdmin && !autoAuthorized,
    emailVerified: user.emailVerified,
  });
});

app.post(
  '/api/admin/claim',
  authEndpointLimiter,
  requireFirebaseAuth,
  (req: AuthedRequest, res) => {
    const user = req.firebaseUser!;
    if (!isAllowedOwnerEmail(user.email)) {
      res
        .status(403)
        .json({ error: 'Admin access is restricted to the store owner only.' });
      return;
    }
    if (!user.emailVerified) {
      res
        .status(403)
        .json({ error: 'Verify your owner email address before claiming studio setup.' });
      return;
    }
    if (!isPlainObject(req.body)) {
      res.status(400).json({ error: 'Invalid request payload.' });
      return;
    }

    const { password } = req.body as { password?: string };

    if (getEnvAdminPasscode().length > 0) {
      res
        .status(400)
        .json({ error: 'Admin passcode is configured via environment variables.' });
      return;
    }

    const cleanPass = String(password || '');
    if (cleanPass.length < 8 || cleanPass.length > 128) {
      res
        .status(400)
        .json({ error: 'Choose an admin password between 8 and 128 characters.' });
      return;
    }

    const ok = claimFirstAdmin(user.uid, user.email, cleanPass);
    if (!ok) {
      res.status(409).json({
        error: 'Admin access has already been claimed. Sign in with your admin password.',
      });
      return;
    }

    const adminToken = signAdminToken(user.uid, user.email);
    res.json({ adminToken });
  }
);

app.post('/api/admin/unlock', requireFirebaseAuth, (req: AuthedRequest, res) => {
  const user = req.firebaseUser!;
  if (!isAllowedOwnerEmail(user.email)) {
    res
      .status(403)
      .json({ error: 'Admin access is restricted to the store owner only.' });
    return;
  }

  const ip = getClientIp(req);
  const lockSec = getAuthLockoutRemainingSec(ip, user.email);
  if (lockSec > 0) {
    res.setHeader('Retry-After', String(lockSec));
    res.status(429).json({
      error: `Too many failed unlock attempts. Locked for ${Math.ceil(
        lockSec / 60
      )} minute(s).`,
    });
    return;
  }

  if (isOwnerAutoAuthorized(user)) {
    clearAuthFailures(ip, user.email);
    const adminToken = signAdminToken(user.uid, user.email);
    res.json({ adminToken });
    return;
  }

  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }

  const { password } = req.body as { password?: string };
  const cleanPass = String(password || '');
  if (!cleanPass || !verifyAdminPassword(cleanPass)) {
    const triggeredLockSec = recordAuthFailure(ip, user.email);
    if (triggeredLockSec > 0) {
      res.setHeader('Retry-After', String(triggeredLockSec));
      res.status(429).json({
        error: 'Too many failed unlock attempts. Please try again in 15 minutes.',
      });
      return;
    }
    res.status(403).json({ error: 'Invalid admin password.' });
    return;
  }

  clearAuthFailures(ip, user.email);
  const adminToken = signAdminToken(user.uid, user.email);
  res.json({ adminToken });
});

// ========================
// PROTECTED ADMIN APIs
// ========================
app.use('/api/admin', adminWriteLimiter);

app.get('/api/admin/storefront', requireAdminSession, (_req, res) => {
  res.json({ storefrontSettings: getStorefrontSettings() });
});

app.put('/api/admin/storefront', requireAdminSession, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const current = getStorefrontSettings();
  const body = req.body as Partial<{
    storeName: string;
    tagline: string;
    heroEyebrow: string;
    heroHeadline: string;
    heroSubtitle: string;
    heroCtaText: string;
    announcementText: string;
    spotlightProductId: string;
    storyTitle: string;
    storyBody: string;
  }>;

  let nextSpotlight = current.spotlightProductId;
  if (body.spotlightProductId !== undefined) {
    const candidateId = String(body.spotlightProductId).trim().slice(0, 80);
    if (candidateId) {
      const exists = db
        .prepare('SELECT id FROM products WHERE id = ?')
        .get(candidateId);
      if (!exists) {
        res.status(400).json({ error: 'Selected spotlight product does not exist.' });
        return;
      }
      nextSpotlight = candidateId;
    }
  }

  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE store_settings
    SET store_name = ?,
        tagline = ?,
        hero_eyebrow = ?,
        hero_headline = ?,
        hero_subtitle = ?,
        hero_cta_text = ?,
        announcement_text = ?,
        spotlight_product_id = ?,
        story_title = ?,
        story_body = ?,
        updated_at = ?
    WHERE id = 1
  `).run(
    body.storeName !== undefined
      ? String(body.storeName).trim().slice(0, 80) || current.storeName
      : current.storeName,
    body.tagline !== undefined
      ? String(body.tagline).trim().slice(0, 160) || current.tagline
      : current.tagline,
    body.heroEyebrow !== undefined
      ? String(body.heroEyebrow).trim().slice(0, 80) || current.heroEyebrow
      : current.heroEyebrow,
    body.heroHeadline !== undefined
      ? String(body.heroHeadline).trim().slice(0, 160) || current.heroHeadline
      : current.heroHeadline,
    body.heroSubtitle !== undefined
      ? String(body.heroSubtitle).trim().slice(0, 600) || current.heroSubtitle
      : current.heroSubtitle,
    body.heroCtaText !== undefined
      ? String(body.heroCtaText).trim().slice(0, 60) || current.heroCtaText
      : current.heroCtaText,
    body.announcementText !== undefined
      ? String(body.announcementText).trim().slice(0, 200) || current.announcementText
      : current.announcementText,
    nextSpotlight,
    body.storyTitle !== undefined
      ? String(body.storyTitle).trim().slice(0, 160) || current.storyTitle
      : current.storyTitle,
    body.storyBody !== undefined
      ? String(body.storyBody).trim().slice(0, 1500) || current.storyBody
      : current.storyBody,
    updatedAt
  );

  res.json({ storefrontSettings: getStorefrontSettings() });
});

app.get('/api/admin/overview', requireAdminSession, (_req, res) => {
  const prodCount = (
    db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }
  ).c;
  const uploadedCount = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM products WHERE deliverable_file_key IS NOT NULL'
      )
      .get() as { c: number }
  ).c;
  const orderStats = db
    .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS rev FROM orders')
    .get() as { c: number; rev: number };
  const subCount = (
    db.prepare('SELECT COUNT(*) AS c FROM subscribers').get() as { c: number }
  ).c;
  const msgCount = (
    db.prepare('SELECT COUNT(*) AS c FROM contact_messages').get() as { c: number }
  ).c;

  res.json({
    productCount: prodCount,
    uploadedFileCount: uploadedCount,
    orderCount: orderStats.c,
    totalRevenue: Number(orderStats.rev),
    subscriberCount: subCount,
    messageCount: msgCount,
  });
});

app.get('/api/admin/products', requireAdminSession, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM products ORDER BY featured DESC, created_at DESC')
    .all() as unknown as DbProductRow[];
  res.json({ products: rows.map(mapProductRow) });
});

app.post('/api/admin/products', requireAdminSession, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const body = req.body as {
    title?: string;
    subtitle?: string;
    category?: string;
    productType?: string;
    shortDesc?: string;
    fullDesc?: string;
    price?: number;
    compareAtPrice?: number;
    priceNote?: string;
    isDemoProduct?: boolean;
    featured?: boolean;
    cardBg?: string;
    image?: string;
    whatsIncluded?: string[];
    fileFormats?: string[];
    compatibility?: string[];
  };

  const title = String(body.title || '').trim().slice(0, 160);
  if (!title) {
    res.status(400).json({ error: 'Product title is required.' });
    return;
  }

  let image = '/assets/images/solobiz_os_showcase_1795209164172.jpg';
  if (body.image !== undefined && String(body.image).trim() !== '') {
    const cleanImg = sanitizeMediaUrl(String(body.image));
    if (!cleanImg) {
      res.status(400).json({
        error: 'Product image must be a valid HTTP(S) URL or local /uploads/ or /assets/ path.',
      });
      return;
    }
    image = cleanImg;
  }

  const parsedPrice = Number(body.price ?? 0);
  if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 100000) {
    res.status(400).json({ error: 'Product price must be between 0 and 100,000.' });
    return;
  }

  const rawCardBg = String(body.cardBg || '#FFFDF7').trim();
  const safeCardBg = /^#[0-9A-Fa-f]{6}$/.test(rawCardBg) ? rawCardBg : '#FFFDF7';

  const id = `prod-${crypto.randomUUID().slice(0, 8)}`;
  const baseSlug = sanitizeSlug(title) || id;
  const existingSlug = db
    .prepare('SELECT id FROM products WHERE slug = ?')
    .get(baseSlug);
  const slug = existingSlug ? `${baseSlug}-${id.slice(-4)}` : baseSlug;

  const shortDesc =
    String(body.shortDesc || '').trim().slice(0, 600) ||
    'Practical digital tool crafted by CraftedLabs.';
  const fullDesc = String(body.fullDesc || '').trim().slice(0, 4000) || shortDesc;

  const cleanList = (arr: unknown, fallback: string[]) =>
    Array.isArray(arr) && arr.length > 0
      ? arr
          .slice(0, 20)
          .map((item) => String(item || '').trim().slice(0, 200))
          .filter(Boolean)
      : fallback;

  db.prepare(`
    INSERT INTO products (
      id, slug, title, subtitle, category, product_type, short_desc, full_desc,
      price, compare_at_price, price_note, is_demo_product, featured, created_at,
      card_bg, image, image_alt, gallery_json, whats_included_json, who_it_is_for_json,
      benefits_json, file_formats_json, compatibility_json, faqs_json, deliverable_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    slug,
    title,
    String(body.subtitle || shortDesc).trim().slice(0, 300),
    String(body.category || 'business-entrepreneurship').trim().slice(0, 80),
    String(body.productType || 'Digital PDF & Template').trim().slice(0, 80),
    shortDesc,
    fullDesc,
    Number(parsedPrice.toFixed(2)),
    body.compareAtPrice && Number.isFinite(Number(body.compareAtPrice))
      ? Math.max(0, Number(Number(body.compareAtPrice).toFixed(2)))
      : null,
    body.priceNote ? String(body.priceNote).trim().slice(0, 120) : null,
    body.isDemoProduct === false ? 0 : 1,
    body.featured ? 1 : 0,
    new Date().toISOString().slice(0, 10),
    safeCardBg,
    image,
    title,
    JSON.stringify([{ src: image, alt: title, caption: title }]),
    JSON.stringify(
      cleanList(body.whatsIncluded, ['Digital deliverable file', 'Setup documentation'])
    ),
    JSON.stringify(['Independent professionals and creators']),
    JSON.stringify(['Ready for immediate download and everyday workflows']),
    JSON.stringify(cleanList(body.fileFormats, ['PDF'])),
    JSON.stringify(
      cleanList(body.compatibility, ['Any modern PDF reader / spreadsheet editor'])
    ),
    JSON.stringify([
      {
        q: 'How is this delivered?',
        a: 'Available immediately after completing Demo Checkout.',
      },
    ]),
    'Download your verified package from the confirmation view or Customer Account.'
  );

  const created = db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(id) as unknown as DbProductRow;
  res.status(201).json({ product: mapProductRow(created) });
});

app.put('/api/admin/products/:id', requireAdminSession, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const id = String(req.params.id || '').slice(0, 80);
  const existing = db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(id) as unknown as DbProductRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  const body = req.body as Partial<{
    title: string;
    subtitle: string;
    category: string;
    productType: string;
    shortDesc: string;
    fullDesc: string;
    price: number;
    featured: boolean;
    isDemoProduct: boolean;
    image: string;
  }>;

  let nextImage = existing.image;
  if (body.image !== undefined) {
    const cleanImg = sanitizeMediaUrl(String(body.image));
    if (!cleanImg) {
      res.status(400).json({
        error: 'Product image must be a valid HTTP(S) URL or local /uploads/ or /assets/ path.',
      });
      return;
    }
    nextImage = cleanImg;
  }

  let nextPrice = existing.price;
  if (body.price !== undefined) {
    const parsedPrice = Number(body.price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 100000) {
      res.status(400).json({ error: 'Product price must be between 0 and 100,000.' });
      return;
    }
    nextPrice = Number(parsedPrice.toFixed(2));
  }

  const nextTitle =
    body.title !== undefined
      ? String(body.title).trim().slice(0, 160) || existing.title
      : existing.title;

  db.prepare(`
    UPDATE products
    SET title = ?, subtitle = ?, category = ?, product_type = ?,
        short_desc = ?, full_desc = ?, price = ?, featured = ?,
        is_demo_product = ?, image = ?
    WHERE id = ?
  `).run(
    nextTitle,
    body.subtitle !== undefined
      ? String(body.subtitle).trim().slice(0, 300)
      : existing.subtitle,
    body.category !== undefined
      ? String(body.category).trim().slice(0, 80)
      : existing.category,
    body.productType !== undefined
      ? String(body.productType).trim().slice(0, 80)
      : existing.product_type,
    body.shortDesc !== undefined
      ? String(body.shortDesc).trim().slice(0, 600)
      : existing.short_desc,
    body.fullDesc !== undefined
      ? String(body.fullDesc).trim().slice(0, 4000)
      : existing.full_desc,
    nextPrice,
    body.featured !== undefined ? (body.featured ? 1 : 0) : existing.featured,
    body.isDemoProduct !== undefined
      ? body.isDemoProduct
        ? 1
        : 0
      : existing.is_demo_product,
    nextImage,
    id
  );

  const updated = db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(id) as unknown as DbProductRow;
  res.json({ product: mapProductRow(updated) });
});

app.delete('/api/admin/products/:id', requireAdminSession, (req, res) => {
  const id = String(req.params.id || '').slice(0, 80);
  const existing = db
    .prepare('SELECT deliverable_file_key FROM products WHERE id = ?')
    .get(id) as { deliverable_file_key: string | null } | undefined;

  if (existing?.deliverable_file_key) {
    const filePath = safeResolveWithin(PRIVATE_FILES_DIR, existing.deliverable_file_key);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Upload PDF / Digital Deliverable File for a Product (magic-byte verified)
app.post(
  '/api/admin/products/:id/deliverable',
  requireAdminSession,
  deliverableUpload.single('file'),
  (req, res) => {
    const id = String(req.params.id || '').slice(0, 80);
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Please select a PDF or digital file to upload.' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!verifyUploadedFileSignature(file.path, ext)) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore unlink error
      }
      res.status(400).json({
        error: 'Uploaded file content does not match its declared file extension.',
      });
      return;
    }

    const existing = db
      .prepare('SELECT id, deliverable_file_key FROM products WHERE id = ?')
      .get(id) as { id: string; deliverable_file_key: string | null } | undefined;

    if (!existing) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    if (existing.deliverable_file_key) {
      const oldPath = safeResolveWithin(PRIVATE_FILES_DIR, existing.deliverable_file_key);
      if (oldPath && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const safeOriginal = sanitizeDownloadFilename(file.originalname, `deliverable${ext}`);

    db.prepare(`
      UPDATE products
      SET deliverable_file_key = ?,
          deliverable_file_name = ?,
          deliverable_file_size = ?,
          deliverable_mime_type = ?
      WHERE id = ?
    `).run(file.filename, safeOriginal, file.size, file.mimetype, id);

    const updated = db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(id) as unknown as DbProductRow;
    res.json({ product: mapProductRow(updated) });
  }
);

// Upload Product Preview Image (magic-byte verified)
app.post(
  '/api/admin/upload/preview',
  requireAdminSession,
  previewUpload.single('image'),
  (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Please select a JPG, PNG, or WEBP image.' });
      return;
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!verifyUploadedFileSignature(file.path, ext)) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
      res.status(400).json({
        error: 'Uploaded file is not a valid JPG, PNG, or WEBP image.',
      });
      return;
    }
    res.json({ url: `/uploads/${file.filename}` });
  }
);

app.get('/api/admin/orders', requireAdminSession, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC')
    .all() as unknown as {
      id: string;
      created_at: string;
      customer_email: string;
      user_id: string | null;
      items_json: string;
      subtotal: number;
      discount_code: string | null;
      discount_amount: number;
      total: number;
      currency: string;
      payment_method: string;
      payment_provider_name: string;
      status: string;
      download_count: number;
      last_downloaded_at: string | null;
    }[];

  res.json({
    orders: rows.map((o) => ({
      id: o.id,
      createdAt: o.created_at,
      customerEmail: o.customer_email,
      userId: o.user_id ?? undefined,
      items: JSON.parse(o.items_json),
      subtotal: Number(o.subtotal),
      discountCode: o.discount_code ?? undefined,
      discountAmount: Number(o.discount_amount),
      total: Number(o.total),
      currency: o.currency,
      paymentMethod: o.payment_method,
      paymentProviderName: o.payment_provider_name,
      status: o.status,
      downloadCount: Number(o.download_count),
      lastDownloadedAt: o.last_downloaded_at ?? undefined,
    })),
  });
});

app.get('/api/admin/subscribers', requireAdminSession, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM subscribers ORDER BY created_at DESC')
    .all() as unknown as {
      id: string;
      first_name: string | null;
      email: string;
      consent_given: number;
      source: string;
      resource_name: string | null;
      created_at: string;
    }[];

  res.json({
    subscribers: rows.map((s) => ({
      id: s.id,
      firstName: s.first_name ?? undefined,
      email: s.email,
      consentGiven: s.consent_given === 1,
      source: s.source,
      resourceName: s.resource_name ?? undefined,
      createdAt: s.created_at,
    })),
  });
});

app.get('/api/admin/messages', requireAdminSession, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM contact_messages ORDER BY created_at DESC')
    .all();
  res.json({ messages: rows });
});

app.post('/api/admin/blog', requireAdminSession, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const { title, category, excerpt, body } = req.body as {
    title?: string;
    category?: string;
    excerpt?: string;
    body?: string[];
  };
  const cleanTitle = String(title || '').trim().slice(0, 180);
  if (!cleanTitle) {
    res.status(400).json({ error: 'Article title is required.' });
    return;
  }

  const id = `blog-${crypto.randomUUID().slice(0, 8)}`;
  const slug = sanitizeSlug(cleanTitle) || id;
  const cleanExcerpt =
    String(excerpt || '').trim().slice(0, 1000) || 'Editorial note from CraftedLabs.';
  const paragraphs =
    Array.isArray(body) && body.length > 0
      ? body
          .slice(0, 30)
          .map((p) => String(p || '').trim().slice(0, 4000))
          .filter(Boolean)
      : [cleanExcerpt];
  const cleanCategory =
    String(category || 'Small Business').trim().slice(0, 60) || 'Small Business';
  const publishedAt = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });

  db.prepare(`
    INSERT INTO blog_articles (
      id, slug, category, title, excerpt, published_at, read_time, image, image_alt, body_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    slug,
    cleanCategory,
    cleanTitle,
    cleanExcerpt,
    publishedAt,
    '3 min read',
    '/assets/images/craftedlabs_studio_story_1795209165556.jpg',
    cleanTitle,
    JSON.stringify(paragraphs)
  );

  res.status(201).json({
    article: {
      id,
      slug,
      category: cleanCategory,
      title: cleanTitle,
      excerpt: cleanExcerpt,
      publishedAt,
      readTime: '3 min read',
      image: '/assets/images/craftedlabs_studio_story_1795209165556.jpg',
      imageAlt: cleanTitle,
      body: paragraphs,
    },
  });
});

app.delete('/api/admin/blog/:id', requireAdminSession, (req, res) => {
  db.prepare('DELETE FROM blog_articles WHERE id = ?').run(
    String(req.params.id || '').slice(0, 80)
  );
  res.json({ ok: true });
});

app.get('/api/admin/discounts', requireAdminSession, (_req, res) => {
  const rows = db
    .prepare('SELECT code, percent_off, active, description FROM discount_codes')
    .all() as unknown as {
      code: string;
      percent_off: number;
      active: number;
      description: string;
    }[];
  res.json({
    discountCodes: rows.map((d) => ({
      code: d.code,
      percentOff: Number(d.percent_off),
      active: d.active === 1,
      description: d.description,
    })),
  });
});

app.post('/api/admin/discounts', requireAdminSession, (req, res) => {
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const { code, percentOff, description } = req.body as {
    code?: string;
    percentOff?: number;
    description?: string;
  };
  const normalized = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  if (!normalized) {
    res.status(400).json({ error: 'Valid discount code is required.' });
    return;
  }
  const rawPct = Number(percentOff);
  const pct = Number.isFinite(rawPct)
    ? Math.min(90, Math.max(1, Math.round(rawPct)))
    : 10;
  const desc = String(description || `${pct}% store discount`).trim().slice(0, 160);

  db.prepare(`
    INSERT INTO discount_codes (code, percent_off, active, description)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(code) DO UPDATE SET
      percent_off = excluded.percent_off,
      active = 1,
      description = excluded.description
  `).run(normalized, pct, desc);

  res.status(201).json({
    discountCode: { code: normalized, percentOff: pct, active: true, description: desc },
  });
});

app.patch(
  '/api/admin/discounts/:code/toggle',
  requireAdminSession,
  (req, res) => {
    const normalized = String(req.params.code || '')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 32);
    const row = db
      .prepare('SELECT active FROM discount_codes WHERE code = ?')
      .get(normalized) as { active: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Discount code not found.' });
      return;
    }
    const nextActive = row.active === 1 ? 0 : 1;
    db.prepare('UPDATE discount_codes SET active = ? WHERE code = ?').run(
      nextActive,
      normalized
    );
    res.json({ code: normalized, active: nextActive === 1 });
  }
);

// Sanitized error handler (never exposes stack traces or internal file paths)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ClientValidationError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded file exceeds the maximum allowed size limit.'
        : 'Invalid file upload request.';
    res.status(400).json({ error: message });
    return;
  }
  if (err instanceof SyntaxError && 'status' in err) {
    res.status(400).json({ error: 'Invalid JSON payload.' });
    return;
  }
  res.status(500).json({ error: 'Internal server error.' });
});

export default app;
