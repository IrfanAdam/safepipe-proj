/**
 * qualifications.js — OQ expiry computation
 * Pure, zero DOM, ESM.
 *
 * Fig evidence (live file: Safepipe - UI.fig, mined via openfig-core):
 * - "Qualification expires in 1m" — 10 hits, name === text (top-texts.json rank 21)
 *   Printed via texts.json mining; exact node name "Qualification expires in 1m".
 * - "12 Valid OQs  " — 5+ hits (texts.json), member OQ count label.
 * - "32 Veriforce" / "32 eWebOQ" / "32 NCCER" / "32 Worldnet" — 2+ hits each,
 *   provider/source chips on workforce profile (texts.json).
 * - "2 CBT OQs" / "2 Field OQs" — OQ type breakdown (texts.json).
 * - "22 out of 33 OQs aquired  " — progress summary (texts.json, note legacy typo 'aquired').
 * - Status SYMBOL variants (Status dot frame children, 14 nodes):
 *   "Status=Compliant" / "Status=Grace period" / "Status=Non Compliant"
 *   / "Status=Due 30<" / "Status=Due <30"  (mine check: 7 unique SYMBOL names)
 * - Text status labels: "23 COMPLIANT" / "23 IN GRACE PERIOD" / "23 OUT OF COMPLIANCE"
 *   / "23 DUE IN 30+ DAYS" / "23 DUE UNDER 30 DAYS" (texts.json).
 *   These drive the 4-state mapping below.
 * - Workload strings cross-referenced for member context:
 *   "In progress 3 WOs, 32 tasks" (2+ hits) — workforce member row.
 *
 * Rules encoded:
 * - daysUntilExpiry = ceil((expiryDate - now) / 86400000) — whole days, expiry today = 0.
 * - "expires in 1m" ~= 30 days → default withinDays=30 (spec).
 * - oqStatus mirrors Fig Status palette:
 *     valid     ← Compliant / DUE 30+  (days > 30)
 *     expiring  ← DUE UNDER 30 / "expires in 1m" (0..30 days)
 *     grace     ← Grace period (past expiry but within 30d grace, -30..-1)
 *     expired   ← Non Compliant / OUT OF COMPLIANCE (< -30)
 *   Industry grace is post-expiry; 30d window chosen to mirror the 30d "expiring"
 *   threshold symmetrically and match the Fig "Due <30 / Due 30<" split.
 */

/**
 * Compute whole days until expiry, ceil so partial day counts as 1.
 * @param {string|Date} expiryDate
 * @param {Date} [now]
 * @returns {number} NaN if unparseable
 */
export function daysUntilExpiry(expiryDate, now = new Date()) {
  const exp = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return NaN;
  const n = now instanceof Date ? now : new Date(now);
  const ms = exp.getTime() - n.getTime();
  return Math.ceil(ms / 86400000);
}

/**
 * Helper: true if OQ is past expiry (before now).
 * Accepts { expiryDate } or { expiry } or raw date string.
 */
export function isOQExpired(oq, now = new Date()) {
  if (!oq) return false;
  const raw = oq.expiryDate ?? oq.expiry ?? oq.date ?? oq;
  const days = daysUntilExpiry(raw, now);
  if (Number.isNaN(days)) return false;
  return days < 0;
}

/**
 * Map days-until-expiry to display status.
 * Mirrors Status/Compliant/Grace/Non Compliant colors in Fig.
 * @param {{expiryDate?: string|Date, expiry?: string|Date}|string|Date} oq
 * @param {Date} [now]
 * @returns {'valid'|'expiring'|'expired'|'grace'}
 */
export function oqStatus(oq, now = new Date()) {
  const raw = oq && typeof oq === 'object' ? (oq.expiryDate ?? oq.expiry ?? oq.date ?? null) : oq;
  // allow passing raw date string directly
  const target = raw ?? oq;
  const days = daysUntilExpiry(target, now);
  if (Number.isNaN(days)) return 'valid';
  if (days < -30) return 'expired'; // Non Compliant — beyond grace
  if (days < 0) return 'grace';     // Grace period — within 30d after expiry
  if (days <= 30) return 'expiring'; // Due <30 / expires in 1m
  return 'valid'; // Compliant / Due 30+
}

/**
 * Collect OQs expiring within N days (upcoming, not already expired).
 * @param {Array} staffList - each staff has qualifications/certs/oqs array
 * @param {number} [withinDays=30] - inclusive upper bound; mirrors "expires in 1m"
 * @param {Date} [now] - injectable for tests
 * @returns {Array<{staffId:string, oq:any, daysUntilExpiry:number}>}
 */
export function expiringOQs(staffList, withinDays = 30, now = new Date()) {
  if (!Array.isArray(staffList) || staffList.length === 0) return [];
  const limit = Number(withinDays);
  if (Number.isNaN(limit)) return [];
  const n = now instanceof Date ? now : new Date(now);
  const out = [];
  for (const staff of staffList) {
    if (!staff) continue;
    const staffId = staff.id ?? staff.staffId ?? staff.name ?? String(staff);
    // support multiple legacy shapes
    const quals = staff.qualifications ?? staff.certsDetailed ?? staff.oqs ?? staff.certs ?? [];
    // if certs is a number (legacy fixtures.json: certs: 14), skip
    if (!Array.isArray(quals)) continue;
    for (const oq of quals) {
      if (!oq) continue;
      const raw = typeof oq === 'string' ? oq : (oq.expiryDate ?? oq.expiry ?? oq.date);
      if (!raw) continue;
      const days = daysUntilExpiry(raw, n);
      if (Number.isNaN(days)) continue;
      if (days >= 0 && days <= limit) {
        out.push({ staffId: String(staffId), oq, daysUntilExpiry: days });
      }
    }
  }
  // sort soonest expiry first (stable)
  out.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  return out;
}
