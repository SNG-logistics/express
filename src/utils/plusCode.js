/**
 * plusCode.js — Plus Codes (Open Location Code) as a way to enter a location.
 *
 * Staff setting up a branch have a phone, not a GPS readout. Google Maps hands
 * out a Plus Code in two taps — long-press, copy — while decimal latitude and
 * longitude have to be dug out of a menu and retyped without a slip. So the
 * form takes a Plus Code; what gets STORED is still lat/lng, because that is
 * what distance, zones and fees are computed from.
 *
 * The dangerous case is the short code. "JJXX+HR8" is what Maps shows most
 * prominently, but it is only meaningful near a reference point — the same
 * short code repeats roughly every degree, so recovering it against the wrong
 * reference returns a confident, wrong answer several kilometres away. Nothing
 * here recovers a short code without being given a reference, and callers are
 * expected to show the decoded position back for a human to confirm.
 */
import { OpenLocationCode } from 'open-location-code';

const olc = new OpenLocationCode();

/**
 * A coordinate that is absent, not a number that happens to be zero.
 *
 * `Number(null)` and `Number('')` are both 0, and 0 is a finite, perfectly
 * valid latitude — so a missing reference point reads as "somewhere in the
 * Gulf of Guinea" and a short code recovers there instead of being refused.
 */
function num(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Plus Codes are case-insensitive and often pasted with the locality attached. */
function tidy(raw) {
  return String(raw ?? '')
    .trim()
    .split(/[,\s]/)[0]   // "JJXX+HR8, สมุทรปราการ" → "JJXX+HR8"
    .toUpperCase();
}

/**
 * @param {string} raw           a full or short Plus Code
 * @param {number|null} refLat   reference latitude, required for short codes
 * @param {number|null} refLng
 * @returns {{lat:number, lng:number, code:string, wasShort:boolean}|null}
 *   null when the code is unusable — including a short code with no reference,
 *   which is a refusal to guess rather than a parsing failure.
 */
export function decodePlusCode(raw, refLat = null, refLng = null) {
  const code = tidy(raw);
  if (!code) return null;

  try {
    if (!olc.isValid(code)) return null;

    let full = code;
    let wasShort = false;

    if (olc.isShort(code)) {
      const lat = num(refLat);
      const lng = num(refLng);
      // Recovering against a wrong reference yields a plausible-looking answer
      // in the wrong place, so refuse rather than pick a reference ourselves.
      if (lat === null || lng === null) return null;
      full = olc.recoverNearest(code, lat, lng);
      wasShort = true;
    } else if (!olc.isFull(code)) {
      return null;
    }

    const area = olc.decode(full);
    return {
      lat: Number(area.latitudeCenter.toFixed(8)),
      lng: Number(area.longitudeCenter.toFixed(8)),
      code: full,
      wasShort,
    };
  } catch {
    // The library throws on malformed input; a bad paste is not an exception.
    return null;
  }
}

/**
 * The Plus Code for a stored position, so a branch that was set up by typing
 * coordinates can still be checked against Google Maps.
 * @returns {string|null}
 */
export function encodePlusCode(lat, lng) {
  const latitude = num(lat);
  const longitude = num(lng);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  try {
    return olc.encode(latitude, longitude);
  } catch {
    return null;
  }
}

/** True when a code needs a reference point before it means anything. */
export function isShortPlusCode(raw) {
  const code = tidy(raw);
  try {
    return Boolean(code) && olc.isValid(code) && olc.isShort(code);
  } catch {
    return false;
  }
}
