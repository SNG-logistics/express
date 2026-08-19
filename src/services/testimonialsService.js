/**
 * testimonialsService.js — proof that real people have used this.
 *
 * A first-time purchase-agent customer is being asked to pay a deposit to a
 * service they have not tried. An unboxing photo and a customer's own words do
 * more for that decision than any amount of copy, which is why this exists —
 * and exactly why it must never contain anything invented.
 *
 * Two independent gates govern what a customer can see: the row must be
 * published AND consent must be recorded. A mis-click on one cannot expose
 * somebody who never agreed to appear.
 */
import pool from '../config/db.js';

/** Read on public pages; the list changes rarely, so it is cached in process. */
let cache = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

export function invalidateTestimonialsCache() {
  cache = null;
}

/**
 * What the public may see. Returns only the display fields — source_ref and
 * everything about consent stay server-side, since they exist for SNG to answer
 * for a claim later, not for a visitor to read.
 *
 * @returns {Promise<Array<{id:number, name:string, message:string|null, photo:string|null}>>}
 *   empty on failure, so a database hiccup cannot take down a shopping page.
 */
export async function getPublishedTestimonials(limit = 12) {
  try {
    if (!cache || Date.now() - cachedAt > CACHE_MS) {
      const [rows] = await pool.query(
        `SELECT id, display_name, message, photo_path
           FROM testimonials
          WHERE status = 'published'
            AND consent_given = 1
          ORDER BY sort_order ASC, id DESC
          LIMIT 50`
      );
      cache = rows;
      cachedAt = Date.now();
    }
    return cache.slice(0, limit).map(row => ({
      id: row.id,
      name: row.display_name,
      message: row.message || null,
      photo: row.photo_path || null,
    }));
  } catch (error) {
    console.error('[Testimonials] load failed:', error.message);
    return [];
  }
}

/** Every row including drafts, for the staff screen. */
export async function listAllTestimonials() {
  const [rows] = await pool.query(
    `SELECT t.*, u.username AS consent_by_name
       FROM testimonials t
       LEFT JOIN users u ON u.id = t.consent_by
      ORDER BY t.sort_order ASC, t.id DESC`
  );
  return rows;
}

/**
 * A testimonial is only publishable once somebody has recorded that the customer
 * agreed. Enforced here rather than trusted to the form, so no future caller can
 * publish by simply setting a status.
 */
export function canPublish(row) {
  return Boolean(row?.consent_given) && Boolean(String(row?.display_name || '').trim());
}
