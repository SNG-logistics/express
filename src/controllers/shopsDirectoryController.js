/**
 * src/controllers/shopsDirectoryController.js
 *
 * Public directory controller for partner shops & member reviews,
 * along with staff administration and review moderation workflows.
 */
import pool from '../config/db.js';

/**
 * GET /shops
 * Public list of published partner shops.
 */
export async function listShops(req, res) {
  const type = (req.query.type || '').trim();
  const q = (req.query.q || '').trim();

  let sql = `
    SELECT s.*,
           COALESCE(AVG(CASE WHEN r.status = 'published' THEN r.rating END), 0) AS avg_rating,
           COUNT(CASE WHEN r.status = 'published' THEN r.id END) AS review_count
    FROM directory_shops s
    LEFT JOIN shop_reviews r ON r.shop_id = s.id
    WHERE s.status = 'published'
  `;
  const params = [];

  if (type) {
    sql += ` AND s.business_type = ?`;
    params.push(type);
  }

  if (q) {
    sql += ` AND (s.name LIKE ? OR s.city LIKE ? OR s.province LIKE ? OR s.description LIKE ?)`;
    const searchPattern = `%${q}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  sql += ` GROUP BY s.id ORDER BY s.sort_order ASC, s.id DESC`;

  try {
    const [shops] = await pool.query(sql, params);

    // Fetch unique business types for filter pills
    const [typesResult] = await pool.query(
      `SELECT DISTINCT business_type FROM directory_shops WHERE status = 'published'`
    );
    const availableTypes = typesResult.map(row => row.business_type).filter(Boolean);

    res.render('customer/shops/index', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.shops')} | SNG Express`,
      shops,
      availableTypes,
      selectedType: type,
      searchQuery: q,
    });
  } catch (err) {
    console.error('[Shops List]', err);
    res.render('customer/shops/index', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.shops')} | SNG Express`,
      shops: [],
      availableTypes: [],
      selectedType: type,
      searchQuery: q,
    });
  }
}

/**
 * GET /shops/:id
 * Public detail page for a single published shop.
 */
export async function shopDetail(req, res) {
  const shopId = req.params.id;
  const customer = req.session?.customer || null;

  try {
    const [[shop]] = await pool.query(
      `SELECT s.*,
              COALESCE(AVG(CASE WHEN r.status = 'published' THEN r.rating END), 0) AS avg_rating,
              COUNT(CASE WHEN r.status = 'published' THEN r.id END) AS review_count
       FROM directory_shops s
       LEFT JOIN shop_reviews r ON r.shop_id = s.id
       WHERE s.id = ? AND s.status = 'published'
       GROUP BY s.id`,
      [shopId]
    );

    if (!shop) {
      return res.status(404).render('customer/404', {
        layout: 'customer/layout',
        title: 'ไม่พบร้านค้าที่ต้องการ | SNG Express',
      });
    }

    // Fetch published reviews
    const [reviews] = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              c.first_name, c.avatar_path
       FROM shop_reviews r
       JOIN customer_accounts c ON c.id = r.customer_account_id
       WHERE r.shop_id = ? AND r.status = 'published'
       ORDER BY r.created_at DESC`,
      [shopId]
    );

    // Check if current logged in member has already submitted a review
    let myReview = null;
    if (customer) {
      const [[userRev]] = await pool.query(
        `SELECT id, rating, comment, status FROM shop_reviews
         WHERE shop_id = ? AND customer_account_id = ?`,
        [shopId, customer.id]
      );
      myReview = userRev || null;
    }

    res.render('customer/shops/detail', {
      layout: 'customer/layout',
      title: `${shop.name} | SNG Express`,
      shop,
      reviews,
      myReview,
      customer,
    });
  } catch (err) {
    console.error('[Shop Detail]', err);
    res.status(500).render('customer/404', {
      layout: 'customer/layout',
      title: 'เกิดข้อผิดพลาด | SNG Express',
    });
  }
}

/**
 * POST /shops/:id/reviews
 * Submit a new shop review (requires logged in customer).
 */
export async function submitReview(req, res) {
  const shopId = req.params.id;
  const customer = req.session?.customer;

  if (!customer) {
    return res.redirect('/member/login');
  }

  const { rating: rawRating, comment } = req.body;
  const rating = Math.max(1, Math.min(5, parseInt(rawRating, 10) || 5));

  try {
    const [[shop]] = await pool.query(
      `SELECT id FROM directory_shops WHERE id = ? AND status = 'published'`,
      [shopId]
    );

    if (!shop) {
      return res.redirect('/shops');
    }

    await pool.query(
      `INSERT INTO shop_reviews (shop_id, customer_account_id, rating, comment, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), status = 'pending'`,
      [shopId, customer.id, rating, (comment || '').trim()]
    );

    req.session.flash = {
      type: 'success',
      message: 'ส่งรีวิวเรียบร้อยแล้ว! เจ้าหน้าที่จะตรวจสอบก่อนแสดงผลบนหน้าเว็บ',
    };
    res.redirect(`/shops/${shopId}`);
  } catch (err) {
    console.error('[Submit Review]', err);
    req.session.flash = {
      type: 'error',
      message: 'เกิดข้อผิดพลาดในการส่งรีวิว กรุณาลองใหม่อีกครั้ง',
    };
    res.redirect(`/shops/${shopId}`);
  }
}

// ─── STAFF ADMIN CONTROLLERS ──────────────────────────────────────────────────

/**
 * GET /admin/shops
 * Staff list of all directory shops.
 */
export async function adminListShops(req, res) {
  try {
    const [shops] = await pool.query(
      `SELECT s.*,
              COUNT(r.id) AS total_reviews,
              COUNT(CASE WHEN r.status = 'pending' THEN 1 END) AS pending_reviews
       FROM directory_shops s
       LEFT JOIN shop_reviews r ON r.shop_id = s.id
       GROUP BY s.id
       ORDER BY s.sort_order ASC, s.id DESC`
    );

    res.render('admin/shops/index', {
      title: 'จัดการร้านค้าพันธมิตร',
      shops,
    });
  } catch (err) {
    console.error('[Admin List Shops]', err);
    res.render('admin/shops/index', {
      title: 'จัดการร้านค้าพันธมิตร',
      shops: [],
    });
  }
}

/**
 * GET /admin/shops/new
 */
export async function adminShowCreate(req, res) {
  res.render('admin/shops/form', {
    title: 'เพิ่มร้านค้าใหม่',
    shop: null,
  });
}

/**
 * POST /admin/shops
 */
export async function adminCreateShop(req, res) {
  const { name, business_type, description, city, province, phone, status, sort_order } = req.body;
  const photoPath = req.file ? `/uploads/shops/${req.file.filename}` : null;

  try {
    await pool.query(
      `INSERT INTO directory_shops
         (name, business_type, description, photo_path, city, province, phone, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        (business_type || 'general').trim(),
        (description || '').trim(),
        photoPath,
        (city || '').trim(),
        (province || '').trim(),
        (phone || '').trim(),
        status || 'draft',
        parseInt(sort_order, 10) || 0,
      ]
    );

    req.session.flash = { type: 'success', message: 'เพิ่มร้านค้าสำเร็จ' };
    res.redirect('/admin/shops');
  } catch (err) {
    console.error('[Admin Create Shop]', err);
    res.render('admin/shops/form', {
      title: 'เพิ่มร้านค้าใหม่',
      shop: req.body,
      error: 'เกิดข้อผิดพลาดในการเพิ่มร้านค้า',
    });
  }
}

/**
 * GET /admin/shops/:id/edit
 */
export async function adminShowEdit(req, res) {
  const shopId = req.params.id;
  const [[shop]] = await pool.query(`SELECT * FROM directory_shops WHERE id = ?`, [shopId]);
  if (!shop) return res.redirect('/admin/shops');

  res.render('admin/shops/form', {
    title: `แก้ไขร้านค้า ${shop.name}`,
    shop,
  });
}

/**
 * POST /admin/shops/:id
 */
export async function adminUpdateShop(req, res) {
  const shopId = req.params.id;
  const { name, business_type, description, city, province, phone, status, sort_order } = req.body;

  try {
    const [[existing]] = await pool.query(`SELECT photo_path FROM directory_shops WHERE id = ?`, [shopId]);
    const photoPath = req.file ? `/uploads/shops/${req.file.filename}` : existing?.photo_path;

    await pool.query(
      `UPDATE directory_shops
       SET name = ?, business_type = ?, description = ?, photo_path = ?,
           city = ?, province = ?, phone = ?, status = ?, sort_order = ?
       WHERE id = ?`,
      [
        name.trim(),
        (business_type || 'general').trim(),
        (description || '').trim(),
        photoPath,
        (city || '').trim(),
        (province || '').trim(),
        (phone || '').trim(),
        status || 'draft',
        parseInt(sort_order, 10) || 0,
        shopId,
      ]
    );

    req.session.flash = { type: 'success', message: 'อัปเดตข้อมูลร้านค้าเรียบร้อยแล้ว' };
    res.redirect('/admin/shops');
  } catch (err) {
    console.error('[Admin Update Shop]', err);
    res.redirect('/admin/shops');
  }
}

/**
 * GET /admin/shops/reviews
 * Staff review moderation queue.
 */
export async function adminListReviews(req, res) {
  try {
    const [reviews] = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
              s.name AS shop_name, c.first_name, c.phone_display
       FROM shop_reviews r
       JOIN directory_shops s ON s.id = r.shop_id
       JOIN customer_accounts c ON c.id = r.customer_account_id
       ORDER BY FIELD(r.status, 'pending', 'published', 'rejected'), r.created_at DESC`
    );

    res.render('admin/shops/reviews', {
      title: 'อนุมัติรีวิวร้านค้า',
      reviews,
    });
  } catch (err) {
    console.error('[Admin List Reviews]', err);
    res.render('admin/shops/reviews', {
      title: 'อนุมัติรีวิวร้านค้า',
      reviews: [],
    });
  }
}

/**
 * POST /admin/shops/reviews/:id/status
 */
export async function adminModerateReview(req, res) {
  const reviewId = req.params.id;
  const { status } = req.body;

  if (!['published', 'rejected'].includes(status)) {
    return res.redirect('/admin/shops/reviews');
  }

  try {
    await pool.query(`UPDATE shop_reviews SET status = ? WHERE id = ?`, [status, reviewId]);
    req.session.flash = { type: 'success', message: `อัปเดตสถานะรีวิวเป็น ${status} เรียบร้อยแล้ว` };
    res.redirect('/admin/shops/reviews');
  } catch (err) {
    console.error('[Admin Moderate Review]', err);
    res.redirect('/admin/shops/reviews');
  }
}
