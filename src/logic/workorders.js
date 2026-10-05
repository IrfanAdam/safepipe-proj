/**
 * workorders.js — work-order state machine + derived fields
 * Pure, zero DOM, ESM. Frozen API for Plan B / Task 5.
 *
 * Fig evidence (live file: Safepipe - UI.fig, via openfig-core + design-context.json)
 * --------------------------------------------------------------------------
 * FRAME "WO status" — type FRAME, w=348 h=125, guid {90014:32635} in "Parking lot" page.
 *   Contains 2 SYMBOL children:
 *     - "Complated=Yes" (SYMBOL, 90014:32636) → TEXT "Completed . in 36 hrs" (90014:32638)
 *     - "Complated=No"  (SYMBOL, 90014:32639) → TEXT "Active . 23 hrs and running" (90014:32641)
 *   Note legacy typo Complated=Yes/No — normalize to completed (Task 2 spec).
 *
 * TEXT nodes (design-context.json textStyles / openfig-core nodes):
 *   - "In progress . San Patricio County, Texas" — count 7 (TEXT, e.g. 89457:14604, 90010:31369)
 *   - "In Progress . Colorado" — 4+ hits (TEXT, 89060:8931 etc)
 *   - "Active" — count 8 (TEXT, e.g. 88563:2541, 91506:73791, 94528:93580)
 *   - "50 % complete" — count 8 (TEXT, e.g. 88859:17213, 89529:18985, 90752:38911)
 *   - "Completed" / "Completed . in 36 hrs" / "completed" (lowercase) — 5 hits (89983:25610 etc)
 *   - "Due in 32 days" — count 8 (TEXT, 88859:17214 etc) + "Due in 23 days" count 8 + "Due in 23 days from now" count 6
 *   - "Assigned 2 days ago" — count 12 (TEXT, 89457:14617 etc) — assignee recency string
 *   - "Assigned to Darrell" — TEXT (88793:6052) + SYMBOL "Assigned" (88793:6082)
 *   - "State=Unassigned" (SYMBOL, 90859:38643) → "Not assigned yet" (90859:38648) / "No member assigned yet"
 *   - "In progress 3 WOs, 32 tasks" — TEXT 93112:183649 — member workload, cross-check.
 *   - "12/32 Items inspected . Due in 23 days" (89809:22454), "3/8 Valves inspected . Due in 23 days" (89754:34594)
 *     — progress + due composite strings.
 *
 * SYMBOL / FRAME progress variants:
 *   - "Knob=Yes, Progress bar=Yes, Completed=No" (SYMBOL×2, 88543:2473, 94528:93536)
 *   - "Knob=Yes, Progress bar=Yes, Completed=Yes" (SYMBOL×2, 88543:2480, 94528:93543)
 *   - "Knob=No,  Progress bar=Yes, Completed=No" (SYMBOL×2, 88543:2487, 94528:93550)
 *   - "Knob=No,  Progress bar=No,  Completed=No" (SYMBOL×2, 88543:2494, 94528:93557)
 *   - "Progress" / "Type=Progress" (SYMBOL×2) — progress pill variants.
 *
 * Due-date ROUNDED_RECTANGLE chips: "Status/Due in 30<" / "Status/Due in <30" (89096:14008/14010)
 *   + "Status/Compliant" / "Status/Grace period" / "Status/Non Compliant" — due buckets.
 *
 * Derived rules encoded:
 *   - States: draft → assigned → in_progress → completed (linear, forward only). Alias: created == draft.
 *   - Guards: cannot transition to completed with unchecked equipment.
 *   - Progress: checkedItems / totalItems (equipment {name, checked}).
 *   - Due math: days until dueDate (ceil), overdue = dueDate < today.
 */

// Canonical states — frozen API (Plan B)
export const STATES = ['draft', 'assigned', 'in_progress', 'completed'];
// Alias for older spec wording (create → assigned …); keep for compatibility
export const STATUSES = STATES;

export const TRANSITIONS = {
  draft: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
};
// Legacy alias map (created == draft)
const ALLOWED = {
  draft: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
  created: ['assigned'],
};

/**
 * Normalize raw status string to canonical.
 * Handles legacy typo Complated → completed, case-insensitive, punctuation,
 * SYMBOL variant forms ("Complated=Yes", "Active=Yes", "State=Unassigned"),
 * composite texts ("In progress . San Patricio County, Texas", "Active . 23 hrs",
 * "Completed . in 36 hrs", "50 % complete"), and extra whitespace.
 *
 * @param {string} raw
 * @returns {string} one of STATES or lowercased trimmed fallback
 */
export function normalizeStatus(raw) {
  if (raw == null) return 'draft';
  let s = String(raw).trim();
  if (!s) return 'draft';
  const lower = s.toLowerCase();
  const fixed = lower.replace(/complated/g, 'completed');

  if (fixed.includes('unassigned') || fixed.includes('not assigned') || fixed.includes('no member assigned')) {
    return 'draft';
  }
  if (fixed.includes('completed')) {
    if (fixed.includes('completed=no') || fixed === 'completed=no') {
      return 'assigned';
    }
    return 'completed';
  }
  if (fixed.includes('in progress') || fixed.includes('50 %') || fixed.includes('50%')) {
    return 'in_progress';
  }
  if (fixed.includes('assigned') || fixed === 'active' || fixed === 'active=yes' || fixed.includes('active .')) {
    return 'assigned';
  }
  if (fixed === 'create' || fixed === 'created' || fixed === 'draft') return 'draft';
  if (fixed === 'assigned') return 'assigned';
  if (fixed === 'in_progress' || fixed === 'in-progress') return 'in_progress';
  if (fixed === 'completed') return 'completed';

  return fixed.replace(/[\s\-\.]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'draft';
}

/**
 * Whether transition from→to is allowed (pure state check, no equipment guard).
 * Normalizes both inputs. Self-transition returns false.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  const f = normalizeStatus(from);
  const t = normalizeStatus(to);
  if (f === t) return false;
  const key = f === 'created' ? 'draft' : f;
  const target = t === 'created' ? 'draft' : t;
  const next = ALLOWED[key] ?? TRANSITIONS[key];
  if (!next) return false;
  return next.includes(target);
}

/**
 * Work-order progress from equipment checklist.
 * wo.equipment: Array<{name:string, checked:boolean}> (spec) OR array of strings
 * (legacy fixtures.json: ["Gas Leak detector", ...] — treat strings as unchecked).
 * Also supports wo.items / wo.checklist / wo.tasks as array fallback.
 *
 * @param {{equipment?: Array, items?: Array, checklist?: Array, tasks?: Array}} wo
 * @returns {{percent:number, checked:number, total:number}}
 */
export function woProgress(wo) {
  if (!wo || typeof wo !== 'object') return { percent: 0, checked: 0, total: 0 };
  let arr = null;
  if (Array.isArray(wo.equipment)) arr = wo.equipment;
  else if (Array.isArray(wo.items)) arr = wo.items;
  else if (Array.isArray(wo.checklist)) arr = wo.checklist;
  else if (Array.isArray(wo.tasks)) arr = wo.tasks;
  else return { percent: 0, checked: 0, total: 0 };

  const total = arr.length;
  if (total === 0) return { percent: 100, checked: 0, total: 0 };

  let checked = 0;
  for (const item of arr) {
    if (item && typeof item === 'object') {
      if (item.checked === true) checked += 1;
      else if (item.done === true) checked += 1;
      else if (item.completed === true) checked += 1;
    } else if (typeof item === 'boolean') {
      if (item === true) checked += 1;
    }
  }
  const percent = Math.round((checked / total) * 100);
  return { percent, checked, total };
}

/**
 * Days until dueDate (ceil). Supports wo.dueDate (ISO string/Date) and
 * fallback wo.dueInDays (number) for legacy fixtures.
 * @param {{dueDate?: string|Date, dueInDays?: number}} wo
 * @param {Date} [now] injectable for tests
 * @returns {number} NaN if no due info
 */
export function dueInDays(wo, now = new Date()) {
  if (!wo || typeof wo !== 'object') return NaN;
  const n = now instanceof Date ? now : new Date(now);
  if (typeof wo.dueInDays === 'number' && Number.isFinite(wo.dueInDays) && !wo.dueDate) {
    return wo.dueInDays;
  }
  if (wo.dueDate != null) {
    const d = wo.dueDate instanceof Date ? wo.dueDate : new Date(wo.dueDate);
    if (Number.isNaN(d.getTime())) return NaN;
    const ms = d.getTime() - n.getTime();
    return Math.ceil(ms / 86400000);
  }
  if (typeof wo.dueInDays === 'number' && Number.isFinite(wo.dueInDays)) {
    return wo.dueInDays;
  }
  return NaN;
}

/**
 * Whether WO is overdue (dueDate in past, or dueInDays < 0).
 * @param {{dueDate?: string|Date, dueInDays?: number}} wo
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOverdue(wo, now = new Date()) {
  const d = dueInDays(wo, now);
  if (Number.isNaN(d)) return false;
  return d < 0;
}

/**
 * Transition WO to new status. Returns new WO (shallow copy) or throws on guard violation.
 * Guards:
 *  - invalid statuses throw
 *  - disallowed edge (canTransition false) throws
 *  - to completed requires all equipment checked (if equipment non-empty)
 *
 * Normalizes legacy typo Complated → completed.
 *
 * @param {{status?:string, state?:string, equipment?:Array}} wo
 * @param {string} toStatus
 * @returns {object} new WO with updated status
 * @throws {Error} on guard violation
 */
export function transitionWO(wo, toStatus) {
  if (!wo || typeof wo !== 'object') throw new Error('Invalid work order');
  const fromRaw = wo.status ?? wo.state ?? 'draft';
  const from = normalizeStatus(fromRaw);
  const to = normalizeStatus(toStatus);

  const fromKey = from === 'created' ? 'draft' : from;
  const toKey = to === 'created' ? 'draft' : to;

  if (!STATES.includes(fromKey)) throw new Error(`Unknown from status: ${fromRaw} (normalized: ${from})`);
  if (!STATES.includes(toKey)) throw new Error(`Unknown to status: ${toStatus} (normalized: ${to})`);

  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${fromKey} → ${toKey}`);
  }

  if (toKey === 'completed') {
    const { checked, total } = woProgress(wo);
    if (total > 0 && checked !== total) {
      throw new Error(`Cannot complete: ${checked}/${total} equipment checked`);
    }
  }

  const next = { ...wo };
  // shallow copy equipment array to keep immutability promise
  if (Array.isArray(wo.equipment)) next.equipment = wo.equipment.slice();
  if ('status' in wo) next.status = toKey;
  else if ('state' in wo) next.state = toKey;
  else next.status = toKey;
  return next;
}

/**
 * List/filter work orders.
 * @param {Array} workOrders
 * @param {{status?:string, assigneeId?:string, assignee?:string, system?:string}} [filter]
 * @returns {Array}
 * Status filter normalizes (so "Complated" matches "completed", "In progress" matches "in_progress").
 * Assignee/system filters are case-insensitive exact (trimmed) match. Supports both assigneeId and assignee.
 */
export function listWorkOrders(workOrders, filter) {
  if (!Array.isArray(workOrders)) return [];
  if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) return workOrders.slice();

  let out = workOrders.slice();

  if (filter.status != null && String(filter.status).trim() !== '') {
    const want = normalizeStatus(filter.status);
    const wantKey = want === 'created' ? 'draft' : want;
    out = out.filter(wo => {
      if (!wo || typeof wo !== 'object') return false;
      const raw = wo.status ?? wo.state ?? '';
      const norm = normalizeStatus(raw);
      const key = norm === 'created' ? 'draft' : norm;
      return key === wantKey;
    });
  }

  const assigneeWant = filter.assigneeId ?? filter.assignee ?? filter.assignedTo ?? filter.assigned ?? null;
  if (assigneeWant != null && String(assigneeWant).trim() !== '') {
    const want = String(assigneeWant).trim().toLowerCase();
    out = out.filter(wo => {
      if (!wo || typeof wo !== 'object') return false;
      // allow matching against any assignee field (id or name)
      const fields = [wo.assigneeId, wo.assignee, wo.assignedTo, wo.owner, wo.assigneeName];
      for (const f of fields) {
        if (f == null) continue;
        const str = typeof f === 'object' ? (f.id ?? f.name ?? '') : f;
        if (String(str).trim().toLowerCase() === want) return true;
      }
      return false;
    });
  }

  const systemWant = filter.system ?? filter.pipeline ?? null;
  if (systemWant != null && String(systemWant).trim() !== '') {
    const want = String(systemWant).trim().toLowerCase();
    out = out.filter(wo => {
      if (!wo || typeof wo !== 'object') return false;
      const v = wo.system ?? wo.pipeline ?? wo.pipelineName ?? '';
      return String(v).trim().toLowerCase() === want;
    });
  }

  return out;
}
