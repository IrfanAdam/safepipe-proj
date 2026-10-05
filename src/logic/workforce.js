/**
 * workforce.js — directory search + workload rollup
 * Pure, zero DOM, ESM.
 *
 * Fig evidence (live file: Safepipe - UI.fig, via openfig-core texts.json):
 * - "In progress 3 WOs, 32 tasks" — 2 hits, member-row workload string (also in legacy-fig-context.md).
 *   Exact member row appears on Workforce page left list; replicated in src/data/fixtures.json
 *   and src/patterns/workforce.js: `In progress ${wos} WOs, ${tasks} tasks`.
 * - "All the Workforce" / "Seeing all 423 staff" — directory header (texts.json, docs/fig-legacy).
 * - "Search the members" — input placeholder (2 hits, texts.json) — drives filterStaff query.
 * - "Staff available " — 9 hits (texts.json) — drives availableOnly predicate.
 * - "12 Valid OQs  " + "32 Veriforce/eWebOQ/NCCER/Worldnet" — cert/qual strings searched by query.
 * - "Raymond Rangel" / "Repair & maintenance" / "Colorado" / "Texas" — name/role/location searchable.
 * - "14 Certificates . Colorado" / "20+ yrs Exp . Repair & maintenance" — combined meta lines.
 * - WO assignment strings: "Torres Rein assigned this to Raymond", "Raymond Rangel are supervising this",
 *   "Darrell Steward is working on this" — assignment wiring.
 * - WO status texts: "In progress", "Completed", "50 % complete", "Due in 23 days", "Due in 32 days",
 *   "Closes 23 days from now, 32 tasks" — used for workload status filter.
 * - Status SYMBOL "Status=Compliant/Grace period/Non Compliant" for OQ context, not workload.
 */

/**
 * Filter staff directory.
 * @param {Array} staffList
 * @param {{query?:string, availableOnly?:boolean}} [opts]
 * @returns {Array}
 *
 * query: case-insensitive substring over name/role/location/certs (spec frozen API).
 * availableOnly: when true, keep only where availability===true (strict).
 * Supports legacy shapes:
 *  - availability boolean field, or `available` boolean, or `status==='Available'` / pill.
 */
export function filterStaff(staffList, { query, availableOnly } = {}) {
  if (!Array.isArray(staffList)) return [];
  let out = staffList.slice();

  if (availableOnly) {
    out = out.filter(s => {
      if (!s || typeof s !== 'object') return false;
      if (s.availability === true) return true;
      if (s.available === true) return true;
      if (s.status === 'Available') return true;
      // allow string status case-insensitive
      if (typeof s.status === 'string' && s.status.toLowerCase() === 'available') return true;
      return false;
    });
  }

  if (typeof query === 'string' && query.trim().length > 0) {
    const q = query.trim().toLowerCase();
    out = out.filter(s => {
      if (!s || typeof s !== 'object') return false;
      const parts = [];
      if (s.name) parts.push(String(s.name));
      if (s.role) parts.push(String(s.role));
      if (s.location) parts.push(String(s.location));
      if (s.exp) parts.push(String(s.exp));
      // certs may be array of strings, or qualifications array
      if (Array.isArray(s.certs)) {
        for (const c of s.certs) if (c != null) parts.push(String(c));
      } else if (typeof s.certs === 'string') {
        parts.push(s.certs);
      }
      if (Array.isArray(s.qualifications)) {
        for (const oq of s.qualifications) {
          if (!oq) continue;
          if (typeof oq === 'string') parts.push(oq);
          else {
            if (oq.name) parts.push(String(oq.name));
            if (oq.title) parts.push(String(oq.title));
            if (oq.provider) parts.push(String(oq.provider));
            if (oq.code) parts.push(String(oq.code));
          }
        }
      }
      if (Array.isArray(s.oqs)) {
        for (const o of s.oqs) {
          if (typeof o === 'string') parts.push(o);
          else if (o && o.name) parts.push(String(o.name));
        }
      }
      // also include raw searchable concatenation
      const hay = parts.join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  return out;
}

/**
 * Workload rollup for one staff member.
 * Mirrors fig member row: "In progress 3 WOs, 32 tasks".
 *
 * @param {string} staffId - staff id or name (matches WO assignee fields)
 * @param {Array} workOrders - each WO has status, assignee/assigneeId/staffId/members, equipment/tasks
 * @returns {{wos:number, tasks:number}}
 *
 * Counts only WOs where status !== completed (case-insensitive).
 * Tasks = sum of equipment length OR tasks count OR explicit taskCount/task count fields.
 * Assignment match: string fields compared case-insensitive trimmed; array fields checked for inclusion.
 */
export function openWorkload(staffId, workOrders) {
  if (!staffId || !Array.isArray(workOrders)) return { wos: 0, tasks: 0 };
  const sid = String(staffId).trim().toLowerCase();
  let wos = 0;
  let tasks = 0;

  for (const wo of workOrders) {
    if (!wo || typeof wo !== 'object') continue;

    // status filter: exclude completed
    const statusRaw = wo.status ?? wo.state ?? '';
    const statusNorm = String(statusRaw).trim().toLowerCase();
    if (statusNorm === 'completed' || statusNorm === 'complete' || statusNorm === 'completed ') continue;
    // also handle legacy typo complated? not needed but be safe: exclude if contains completed
    if (statusNorm.includes('completed')) continue;

    // assignment check
    const assigned = isAssignedTo(wo, sid);
    if (!assigned) continue;

    wos += 1;
    tasks += countTasks(wo);
  }

  return { wos, tasks };
}

function isAssignedTo(wo, sidLower) {
  // direct string fields
  const candidates = [
    wo.assignee,
    wo.assigneeId,
    wo.assignedTo,
    wo.staffId,
    wo.worker,
    wo.owner,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().toLowerCase() === sidLower) return true;
    // numeric id compare as string
    if (c != null && String(c).trim().toLowerCase() === sidLower) return true;
  }
  // array fields
  const arrayFields = [wo.assignees, wo.members, wo.staffIds, wo.assigneeIds, wo.team];
  for (const arr of arrayFields) {
    if (Array.isArray(arr)) {
      for (const m of arr) {
        const ml = String(m ?? '').trim().toLowerCase();
        if (ml && ml === sidLower) return true;
      }
    }
  }
  // object member field with name/id
  if (Array.isArray(wo.assignedStaff)) {
    for (const m of wo.assignedStaff) {
      const v = m?.id ?? m?.name ?? m;
      if (String(v ?? '').trim().toLowerCase() === sidLower) return true;
    }
  }
  return false;
}

function countTasks(wo) {
  // explicit numeric tasks
  if (typeof wo.tasks === 'number' && Number.isFinite(wo.tasks)) return wo.tasks;
  if (typeof wo.taskCount === 'number' && Number.isFinite(wo.taskCount)) return wo.taskCount;
  if (typeof wo.tasksCount === 'number') return wo.tasksCount;
  // array forms
  if (Array.isArray(wo.tasks)) return wo.tasks.length;
  if (Array.isArray(wo.equipment)) return wo.equipment.length;
  if (Array.isArray(wo.items)) return wo.items.length;
  if (Array.isArray(wo.checklist)) return wo.checklist.length;
  // equipment as string like "Gas Leak detector, Pressure gauge, Voltmeter" — count commas+1
  if (typeof wo.equipment === 'string' && wo.equipment.trim()) {
    // if string contains commas, split
    if (wo.equipment.includes(',')) return wo.equipment.split(',').filter(s => s.trim()).length;
    return 0;
  }
  // fallback 0
  return 0;
}
