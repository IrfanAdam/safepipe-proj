import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterStaff, openWorkload } from '../src/logic/workforce.js';

describe('workforce — filterStaff + openWorkload', () => {
  // Evidence: "In progress 3 WOs, 32 tasks" (member row), "Search the members",
  // "Staff available " (9 hits), provider names Veriforce/NCCER, locations Colorado/Texas

  const staffList = [
    { id: 'S-001', name: 'Raymond Rangel', role: 'Repair & maintenance', location: 'Colorado', availability: true, certs: ['Veriforce', 'NCCER'], exp: '20+ yrs Exp' },
    { id: 'S-002', name: 'Maria Santos', role: 'Cathodic protection', location: 'Texas', availability: false, certs: ['eWebOQ'], exp: '11 yrs Exp' },
    { id: 'S-003', name: 'James Cooper', role: 'Leakage Survey', location: 'Texas', availability: true, certs: ['Worldnet'], exp: '8 yrs Exp' },
    { id: 'S-004', name: 'Ana Reyes', role: 'Compressor Inspection', location: 'Colorado', availability: true, qualifications: [{ name: 'Veriforce - ROW Patrol', provider: 'Veriforce' }], exp: '15 yrs Exp' },
    { id: 'S-005', name: 'David Kim', role: 'Patrol', location: 'Texas', availability: false, certs: [], exp: '6 yrs Exp' },
  ];

  describe('filterStaff', () => {
    it('returns all when no filter', () => {
      assert.equal(filterStaff(staffList, {}).length, 5);
      assert.equal(filterStaff(staffList).length, 5);
    });

    it('query searches name case-insensitive', () => {
      assert.deepEqual(filterStaff(staffList, { query: 'raymond' }).map(s => s.id), ['S-001']);
      assert.deepEqual(filterStaff(staffList, { query: 'RAYMOND' }).map(s => s.id), ['S-001']);
      assert.deepEqual(filterStaff(staffList, { query: 'rangel' }).map(s => s.id), ['S-001']);
    });

    it('query searches role', () => {
      assert.deepEqual(filterStaff(staffList, { query: 'Repair' }).map(s => s.id), ['S-001']);
      assert.deepEqual(filterStaff(staffList, { query: 'cathodic' }).map(s => s.id), ['S-002']);
      assert.deepEqual(filterStaff(staffList, { query: 'Survey' }).map(s => s.id), ['S-003']);
    });

    it('query searches location', () => {
      assert.deepEqual(filterStaff(staffList, { query: 'Colorado' }).map(s => s.id).sort(), ['S-001', 'S-004']);
      assert.deepEqual(filterStaff(staffList, { query: 'texas' }).map(s => s.id).sort(), ['S-002', 'S-003', 'S-005']);
    });

    it('query searches certs / qualifications (Veriforce, NCCER, etc)', () => {
      assert.deepEqual(filterStaff(staffList, { query: 'Veriforce' }).map(s => s.id).sort(), ['S-001', 'S-004']);
      assert.deepEqual(filterStaff(staffList, { query: 'nccer' }).map(s => s.id), ['S-001']);
      assert.deepEqual(filterStaff(staffList, { query: 'worldnet' }).map(s => s.id), ['S-003']);
    });

    it('query trims and handles substring', () => {
      // 'main' is substring of 'maintenance' -> should match S-001
      assert.deepEqual(filterStaff(staffList, { query: '  main  ' }).map(s => s.id), ['S-001']);
      assert.deepEqual(filterStaff(staffList, { query: ' main' }).map(s => s.id), ['S-001']);
      // no-match
      assert.deepEqual(filterStaff(staffList, { query: 'zzz' }).map(s => s.id), []);
      // partial name
      assert.deepEqual(filterStaff(staffList, { query: 'Cooper' }).map(s => s.id), ['S-003']);
    });

    it('availableOnly filters where availability===true (strict)', () => {
      const avail = filterStaff(staffList, { availableOnly: true });
      assert.deepEqual(avail.map(s => s.id).sort(), ['S-001', 'S-003', 'S-004']);
      // ensure S-002 and S-005 excluded (false)
      assert.ok(!avail.find(s => s.id === 'S-002'));
    });

    it('combines query + availableOnly', () => {
      // Colorado + availableOnly => S-001 and S-004
      assert.deepEqual(filterStaff(staffList, { query: 'Colorado', availableOnly: true }).map(s => s.id).sort(), ['S-001', 'S-004']);
      // Texas + availableOnly => only S-003 (S-002, S-005 are unavailable)
      assert.deepEqual(filterStaff(staffList, { query: 'Texas', availableOnly: true }).map(s => s.id), ['S-003']);
      // Veriforce + availableOnly => both S-001 and S-004 are available
      assert.deepEqual(filterStaff(staffList, { query: 'Veriforce', availableOnly: true }).map(s => s.id).sort(), ['S-001', 'S-004']);
    });

    it('handles empty/invalid staffList', () => {
      assert.deepEqual(filterStaff([], { query: 'test' }), []);
      assert.deepEqual(filterStaff(null, { query: 'test' }), []);
      assert.deepEqual(filterStaff(undefined), []);
    });

    it('supports alternate availability field names', () => {
      const alt = [{ id: 'A', name: 'Alt', role: 'Patrol', location: 'Texas', available: true }];
      assert.equal(filterStaff(alt, { availableOnly: true }).length, 1);
      const statusAlt = [{ id: 'B', name: 'B', role: 'Patrol', location: 'Texas', status: 'Available' }];
      assert.equal(filterStaff(statusAlt, { availableOnly: true }).length, 1);
    });
  });

  describe('openWorkload — "In progress 3 WOs, 32 tasks"', () => {
    // Mirrors fig member row string exactly
    const workOrders = [
      { id: 'WO-118', assignee: 'Raymond Rangel', status: 'In progress', equipment: ['Gas Leak detector', 'Pressure gauge', 'Voltmeter'] }, // 3 tasks
      { id: 'WO-119', assignee: 'Raymond Rangel', status: 'In progress', equipment: ['Gas Leak detector', 'Pressure gauge'] }, // 2
      { id: 'WO-120', assignee: 'Raymond Rangel', status: 'Active', tasks: 27 }, // numeric
      { id: 'WO-121', assignee: 'Maria Santos', status: 'In progress', equipment: ['Voltmeter'] }, // 1 - other staff
      { id: 'WO-122', assignee: 'Raymond Rangel', status: 'Completed', equipment: ['A', 'B', 'C', 'D'] }, // excluded
      { id: 'WO-123', assignee: 'Raymond Rangel', status: 'completed', tasks: 5 }, // excluded case-insensitive
      { id: 'WO-124', assignee: 'RAYMOND RANGEL', status: 'In progress', equipment: ['Tool'] }, // case-insensitive match
    ];

    it('returns {wos, tasks} for matching staff, excluding completed', () => {
      const out = openWorkload('Raymond Rangel', workOrders);
      // WOs: WO-118, WO-119, WO-120, WO-124 = 4 (WO-122/123 completed excluded)
      // Tasks: 3 + 2 + 27 + 1 = 33
      assert.deepEqual(out, { wos: 4, tasks: 33 });
    });

    it('matches case-insensitive and handles different assignee fields', () => {
      const wos2 = [
        { id: '1', assigneeId: 'S-001', status: 'In progress', equipment: ['A'] },
        { id: '2', staffId: 'S-001', status: 'In progress', tasks: 5 },
        { id: '3', assignees: ['S-001', 'S-002'], status: 'In progress', tasks: 2 },
        { id: '4', assignee: 'S-002', status: 'In progress', tasks: 10 },
      ];
      assert.deepEqual(openWorkload('S-001', wos2), { wos: 3, tasks: 8 });
      assert.deepEqual(openWorkload('s-001', wos2), { wos: 3, tasks: 8 }); // lower case
    });

    it('exact fig example: 3 WOs, 32 tasks', () => {
      const figWOs = [
        { id: 'A', assignee: 'Raymond Rangel', status: 'In progress', equipment: Array(10).fill('item') },
        { id: 'B', assignee: 'Raymond Rangel', status: 'In progress', equipment: Array(12).fill('item') },
        { id: 'C', assignee: 'Raymond Rangel', status: 'In progress', tasks: 10 },
        { id: 'D', assignee: 'Raymond Rangel', status: 'Completed', equipment: Array(100).fill('item') }, // should be excluded
      ];
      // 3 open WOs, 10+12+10 = 32 tasks — matches "In progress 3 WOs, 32 tasks"
      assert.deepEqual(openWorkload('Raymond Rangel', figWOs), { wos: 3, tasks: 32 });
    });

    it('returns zero when no matching WOs or empty input', () => {
      assert.deepEqual(openWorkload('Unknown', workOrders), { wos: 0, tasks: 0 });
      assert.deepEqual(openWorkload('Raymond Rangel', []), { wos: 0, tasks: 0 });
      assert.deepEqual(openWorkload(null, workOrders), { wos: 0, tasks: 0 });
      assert.deepEqual(openWorkload('Raymond Rangel', null), { wos: 0, tasks: 0 });
    });

    it('counts tasks via equipment length or tasks array', () => {
      const wos = [
        { id: '1', assignee: 'X', status: 'In progress', tasks: ['t1', 't2'] }, // array tasks
        { id: '2', assignee: 'X', status: 'In progress', equipment: ['e1'] },
      ];
      assert.deepEqual(openWorkload('X', wos), { wos: 2, tasks: 3 });
    });
  });
});
