/**
 * src/controllers/onlineProductsController.js
 *
 * Public catalog of staff-curated online deals (any platform — Lazada, Shopee,
 * TikTok Shop, etc.) shown at /member/online, plus staff administration.
 * SNG never handles the purchase itself — each card just links out to the
 * product's real listing. Modeled on shopsDirectoryController.js.
 */
import pool from '../config/db.js';

const ALLOWED_PLATFORMS = new Set(['lazada', 'shopee', 'alibaba', 'tiktok_shop', 'makro', 'other']);
const ALLOWED_STATUSES = new Set(['draft', 'published', 'hidden']);
const PRICE_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_PRICE_COLOR = '#E53935';

function parseDiscountPct(raw) {
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Parse a selling/original price: non-negative decimal, or null when absent. */
function parsePrice(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parse a #RRGGBB hex colour, defaulting to the e-commerce red. */
function parsePriceColor(raw) {
  const value = String(raw || '').trim();
  return PRICE_PATTERN.test(value) ? value.toUpperCase() : DEFAULT_PRICE_COLOR;
}

function parsePlatform(raw) {
  const value = (raw || '').trim();
  return ALLOWED_PLATFORMS.has(value) ? value : null;
}

function getUploadedPhotoPaths(files) {
  if (!Array.isArray(files)) return [];
  return files.map(file => `/uploads/products/${file.filename}`);
}

/**
 * GET /member/online
 * Curated grid of published online products, for logged-in members.
 */
export async function listProducts(req, res) {
  try {
    const [products] = await pool.query(
      `SELECT * FROM online_products WHERE status = 'published' ORDER BY sort_order ASC, id DESC`
    );

    res.render('customer/member/online', {
      layout: 'customer/layout',
      title: `${res.locals.t('online.title')} | SNG Express`,
      products,
    });
  } catch (err) {
    console.error('[Online Products List]', err);
    res.render('customer/member/online', {
      layout: 'customer/layout',
      title: `${res.locals.t('online.title')} | SNG Express`,
      products: [],
    });
  }
}

// ─── STAFF ADMIN CONTROLLERS ──────────────────────────────────────────────────

/**
 * GET /admin/products
 * Staff list of all online products, any status.
 */
export async function adminListProducts(req, res) {
  try {
    const [products] = await pool.query(
      `SELECT * FROM online_products ORDER BY sort_order ASC, id DESC`
    );

    res.render('admin/products/index', {
      title: 'จัดการสินค้าออนไลน์',
      products,
    });
  } catch (err) {
    console.error('[Admin List Products]', err);
    res.render('admin/products/index', {
      title: 'จัดการสินค้าออนไลน์',
      products: [],
    });
  }
}

/**
 * GET /admin/products/new
 */
export async function adminShowCreate(req, res) {
  res.render('admin/products/form', {
    title: 'เพิ่มสินค้าออนไลน์ใหม่',
    product: null,
  });
}

/**
 * POST /admin/products
 */
export async function adminCreateProduct(req, res) {
  const { name, badge_label, discount_pct, product_url, platform, status, sort_order } = req.body;
  const photoPaths = getUploadedPhotoPaths(req.files);

  try {
    await pool.query(
      `INSERT INTO online_products
         (name, photos, badge_label, discount_pct, product_url, platform, status, sort_order,
          price, original_price, price_color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        photoPaths.length > 0 ? JSON.stringify(photoPaths) : null,
        (badge_label || '').trim() || null,
        parseDiscountPct(discount_pct),
        product_url.trim(),
        parsePlatform(platform),
        ALLOWED_STATUSES.has(status) ? status : 'draft',
        parseInt(sort_order, 10) || 0,
        parsePrice(req.body.price),
        parsePrice(req.body.original_price),
        parsePriceColor(req.body.price_color),
      ]
    );

    req.session.flash = { type: 'success', message: 'เพิ่มสินค้าสำเร็จ' };
    res.redirect('/admin/products');
  } catch (err) {
    console.error('[Admin Create Product]', err);
    res.render('admin/products/form', {
      title: 'เพิ่มสินค้าออนไลน์ใหม่',
      product: req.body,
      error: 'เกิดข้อผิดพลาดในการเพิ่มสินค้า',
    });
  }
}

/**
 * GET /admin/products/:id/edit
 */
export async function adminShowEdit(req, res) {
  const productId = req.params.id;
  const [[product]] = await pool.query(`SELECT * FROM online_products WHERE id = ?`, [productId]);
  if (!product) return res.redirect('/admin/products');

  res.render('admin/products/form', {
    title: `แก้ไขสินค้า ${product.name}`,
    product,
  });
}

/**
 * POST /admin/products/:id
 */
export async function adminUpdateProduct(req, res) {
  const productId = req.params.id;
  const { name, badge_label, discount_pct, product_url, platform, status, sort_order } = req.body;
  const photoPaths = getUploadedPhotoPaths(req.files);

  try {
    const setClauses = [
      'name = ?',
      'badge_label = ?',
      'discount_pct = ?',
      'product_url = ?',
      'platform = ?',
      'status = ?',
      'sort_order = ?',
      'price = ?',
      'original_price = ?',
      'price_color = ?',
    ];
    const values = [
      name.trim(),
      (badge_label || '').trim() || null,
      parseDiscountPct(discount_pct),
      product_url.trim(),
      parsePlatform(platform),
      ALLOWED_STATUSES.has(status) ? status : 'draft',
      parseInt(sort_order, 10) || 0,
      parsePrice(req.body.price),
      parsePrice(req.body.original_price),
      parsePriceColor(req.body.price_color),
    ];

    // Uploading a new set replaces the gallery. With no files, omit the
    // photos assignment entirely so the existing JSON value is preserved.
    if (photoPaths.length > 0) {
      setClauses.splice(1, 0, 'photos = ?');
      values.splice(1, 0, JSON.stringify(photoPaths));
    }
    values.push(productId);

    await pool.query(
      `UPDATE online_products
       SET ${setClauses.join(', ')}
       WHERE id = ?`,
      values
    );

    req.session.flash = { type: 'success', message: 'อัปเดตข้อมูลสินค้าเรียบร้อยแล้ว' };
    res.redirect('/admin/products');
  } catch (err) {
    console.error('[Admin Update Product]', err);
    res.redirect('/admin/products');
  }
}
