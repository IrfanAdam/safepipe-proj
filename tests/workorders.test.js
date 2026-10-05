import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES,
  TRANSITIONS,
  canTransition,
  transitionWO,
  woProgress,
  dueInDays,
  isOverdue,
  listWorkOrders,
  normalizeStatus,
} from '../src/logic/workorders.js';

const NOW = new Date('2026-01-15T12:00:00Z');
function isoOffset(days) {
  return new Date(NOW.getTime() + days * 86400000).toISOString();
}

function makeWO(overrides = {}) {
  return {
    id: 'WO-TEST',
    status: 'draft',
    dueDate: isoOffset(10),
    system: 'Nueces Bay Pipeline System',
    assigneeId: 'S-001',
    assignee: 'Raymond Rangel',
    equipment: [
      { name: 'Gas Leak detector', checked: false },
      { name: 'Pressure gauge', checked: false },
      { name: 'Voltmeter', checked: false },
    ],
    ...overrides,
  };
}

describe('workorders — state machine (fig-grounded)', () => {
  describe('STATES + TRANSITIONS constants', () => {
    it('exports frozen STATES', () => {
      assert.deepEqual(STATES, ['draft', 'assigned', 'in_progress', 'completed']);
    });
    it('exports TRANSITIONS linear draft→assigned→in_progress→completed', () => {
      assert.deepEqual(TRANSITIONS, {
        draft: ['assigned'],
        assigned: ['in_progress'],
        in_progress: ['completed'],
        completed: [],
      });
    });
  });

  describe('normalizeStatus — legacy Complated typo', () => {
    it('Complated=Yes → completed', () => {
      assert.equal(normalizeStatus('Complated=Yes'), 'completed');
      assert.equal(normalizeStatus('complated'), 'completed');
      assert.equal(normalizeStatus('Completed'), 'completed');
      assert.equal(normalizeStatus('Completed . in 36 hrs'), 'completed');
    });
    it('Complated=No → assigned (not completed)', () => {
      assert.equal(normalizeStatus('Complated=No'), 'assigned');
    });
    it('In progress variants → in_progress', () => {
      assert.equal(normalizeStatus('In progress'), 'in_progress');
      assert.equal(normalizeStatus('In progress . San Patricio County, Texas'), 'in_progress');
      assert.equal(normalizeStatus('50 % complete'), 'in_progress');
      assert.equal(normalizeStatus('In Progress . Colorado'), 'in_progress');
    });
    it('Active → assigned', () => {
      assert.equal(normalizeStatus('Active'), 'assigned');
      assert.equal(normalizeStatus('Active . 23 hrs and running'), 'assigned');
    });
    it('unassigned → draft', () => {
      assert.equal(normalizeStatus('State=Unassigned'), 'draft');
      assert.equal(normalizeStatus('Not assigned yet'), 'draft');
      assert.equal(normalizeStatus('No member assigned yet'), 'draft');
    });
    it('handles created alias to draft', () => {
      assert.equal(normalizeStatus('created'), 'draft');
      assert.equal(normalizeStatus('create'), 'draft');
    });
  });

  describe('canTransition', () => {
    it('allows linear forward steps', () => {
      assert.equal(canTransition('draft', 'assigned'), true);
      assert.equal(canTransition('assigned', 'in_progress'), true);
      assert.equal(canTransition('in_progress', 'completed'), true);
    });
    it('also accepts created alias', () => {
      assert.equal(canTransition('created', 'assigned'), true);
    });
    it('normalizes legacy display strings', () => {
      assert.equal(canTransition('In progress', 'Completed'), true);
      assert.equal(canTransition('Active', 'In progress'), true);
      assert.equal(canTransition('Complated=No', 'In progress'), true);
    });
    it('rejects backward, skip, self, unknown', () => {
      assert.equal(canTransition('assigned', 'draft'), false);
      assert.equal(canTransition('draft', 'in_progress'), false);
      assert.equal(canTransition('draft', 'completed'), false);
      assert.equal(canTransition('assigned', 'completed'), false);
      assert.equal(canTransition('completed', 'assigned'), false);
      assert.equal(canTransition('draft', 'draft'), false);
      assert.equal(canTransition('in_progress', 'in_progress'), false);
    });
  });

  describe('transitionWO — guards + immutability', () => {
    it('draft → assigned succeeds', () => {
      const wo = makeWO({ status: 'draft' });
      const next = transitionWO(wo, 'assigned');
      assert.equal(next.status, 'assigned');
      assert.equal(wo.status, 'draft'); // immutable
      assert.notEqual(next, wo);
    });
    it('assigned → in_progress succeeds', () => {
      const wo = makeWO({ status: 'assigned' });
      const next = transitionWO(wo, 'in_progress');
      assert.equal(next.status, 'in_progress');
    });
    it('in_progress → completed succeeds when all equipment checked', () => {
      const wo = makeWO({
        status: 'in_progress',
        equipment: [
          { name: 'A', checked: true },
          { name: 'B', checked: true },
        ],
      });
      const next = transitionWO(wo, 'completed');
      assert.equal(next.status, 'completed');
    });
    it('in_progress → completed succeeds when no equipment', () => {
      const wo = makeWO({ status: 'in_progress', equipment: [] });
      const next = transitionWO(wo, 'completed');
      assert.equal(next.status, 'completed');
    });
    it('throws when completing with unchecked equipment', () => {
      const wo = makeWO({ status: 'in_progress' }); // 3 unchecked
      assert.throws(() => transitionWO(wo, 'completed'), /Cannot complete/);
      // partial checked still fails
      const partial = makeWO({
        status: 'in_progress',
        equipment: [{ name: 'A', checked: true }, { name: 'B', checked: false }],
      });
      assert.throws(() => transitionWO(partial, 'completed'), /Cannot complete/);
      assert.throws(() => transitionWO(partial, 'Completed'), /Cannot complete/);
      // legacy string equipment treated as unchecked → also fails
      const legacy = makeWO({ status: 'in_progress', equipment: ['Gas Leak detector', 'Pressure gauge'] });
      assert.throws(() => transitionWO(legacy, 'completed'), /Cannot complete/);
    });
    it('throws on invalid edge', () => {
      const wo = makeWO({ status: 'draft' });
      assert.throws(() => transitionWO(wo, 'in_progress'), /Invalid transition/);
      assert.throws(() => transitionWO(wo, 'completed'), /Invalid transition/);
      assert.throws(() => transitionWO(wo, 'draft'), /Invalid transition/);
    });
    it('throws on backward transition', () => {
      const wo = makeWO({ status: 'assigned' });
      assert.throws(() => transitionWO(wo, 'draft'), /Invalid transition/);
      const wo2 = makeWO({ status: 'completed' });
      assert.throws(() => transitionWO(wo2, 'in_progress'), /Invalid transition/);
    });
    it('handles legacy state key "state" instead of status', () => {
      const wo = { id: '1', state: 'draft', equipment: [] };
      const next = transitionWO(wo, 'assigned');
      assert.equal(next.state, 'assigned');
      assert.equal(wo.state, 'draft');
    });
    it('normalizes legacy typo in from status', () => {
      const wo = makeWO({ status: 'Complated=No' }); // normalize to assigned
      const next = transitionWO(wo, 'in_progress');
      assert.equal(next.status, 'in_progress');
    });
    it('throws on invalid wo', () => {
      assert.throws(() => transitionWO(null, 'assigned'), /Invalid work order/);
    });
  });

  describe('woProgress — equipment checkbox → progress pill', () => {
    it('calculates percent correctly', () => {
      const wo = makeWO({
        equipment: [{ name: 'A', checked: true }, { name: 'B', checked: false }, { name: 'C', checked: true }],
      });
      assert.deepEqual(woProgress(wo), { checked: 2, total: 3, percent: 67 });
    });
    it('0 checked → 0%', () => {
      assert.deepEqual(woProgress(makeWO({ equipment: [{ name: 'A', checked: false }] })), { checked: 0, total: 1, percent: 0 });
    });
    it('all checked → 100%', () => {
      assert.deepEqual(
        woProgress(makeWO({ equipment: [{ name: 'A', checked: true }, { name: 'B', checked: true }] })),
        { checked: 2, total: 2, percent: 100 }
      );
    });
    it('empty equipment → 100% (no blockers)', () => {
      assert.deepEqual(woProgress({ equipment: [] }), { checked: 0, total: 0, percent: 100 });
    });
    it('missing equipment → 0/0 100? handled as 0/0', () => {
      assert.deepEqual(woProgress({}), { checked: 0, total: 0, percent: 0 });
      assert.deepEqual(woProgress(null), { checked: 0, total: 0, percent: 0 });
    });
    it('handles legacy string equipment as unchecked', () => {
      const wo = { equipment: ['Gas Leak detector', 'Pressure gauge', 'Voltmeter'] };
      assert.deepEqual(woProgress(wo), { checked: 0, total: 3, percent: 0 });
    });
    it('handles boolean array', () => {
      assert.deepEqual(woProgress({ equipment: [true, false, true] }), { checked: 2, total: 3, percent: 67 });
    });
    it('falls back to tasks/checklist/items', () => {
      assert.deepEqual(woProgress({ tasks: [{ checked: true }, { checked: false }] }), { checked: 1, total: 2, percent: 50 });
    });
    it('50% complete corresponds to half checked', () => {
      const wo = makeWO({ equipment: [{ name: 'A', checked: true }, { name: 'B', checked: false }] });
      const p = woProgress(wo);
      assert.equal(p.percent, 50);
    });
  });

  describe('dueInDays + isOverdue', () => {
    it('computes days until dueDate (ceil)', () => {
      const wo = { dueDate: isoOffset(5) };
      assert.equal(dueInDays(wo, NOW), 5);
      assert.equal(dueInDays({ dueDate: isoOffset(0) }, NOW), 0);
      assert.equal(dueInDays({ dueDate: isoOffset(-3) }, NOW), -3);
    });
    it('ceil handles partial days', () => {
      const halfDay = new Date(NOW.getTime() + 0.3 * 86400000).toISOString();
      assert.equal(dueInDays({ dueDate: halfDay }, NOW), 1);
    });
    it('falls back to dueInDays number', () => {
      assert.equal(dueInDays({ dueInDays: 23 }, NOW), 23);
      assert.equal(dueInDays({ dueInDays: 32 }, NOW), 32);
      // fig strings "Due in 23 days", "Due in 32 days"
      assert.equal(dueInDays({ dueInDays: 23 }), 23);
    });
    it('dueDate takes priority over dueInDays', () => {
      assert.equal(dueInDays({ dueDate: isoOffset(7), dueInDays: 99 }, NOW), 7);
    });
    it('returns NaN for missing/invalid', () => {
      assert.ok(Number.isNaN(dueInDays({}, NOW)));
      assert.ok(Number.isNaN(dueInDays({ dueDate: 'invalid' }, NOW)));
      assert.ok(Number.isNaN(dueInDays(null, NOW)));
    });
    it('isOverdue true when negative', () => {
      assert.equal(isOverdue({ dueDate: isoOffset(-1) }, NOW), true);
      assert.equal(isOverdue({ dueInDays: -2 }, NOW), true);
      assert.equal(isOverdue({ dueDate: isoOffset(0) }, NOW), false);
      assert.equal(isOverdue({ dueDate: isoOffset(5) }, NOW), false);
    });
    it('isOverdue false when no due info', () => {
      assert.equal(isOverdue({}, NOW), false);
      assert.equal(isOverdue({ dueDate: 'bad' }, NOW), false);
    });
    it('accepts Date object for dueDate', () => {
      const wo = { dueDate: new Date(NOW.getTime() + 2 * 86400000) };
      assert.equal(dueInDays(wo, NOW), 2);
    });
  });

  describe('listWorkOrders — filtering', () => {
    const wos = [
      { id: 'WO-1', status: 'draft', assigneeId: 'S-001', assignee: 'Raymond Rangel', system: 'Nueces Bay Pipeline System' },
      { id: 'WO-2', status: 'assigned', assigneeId: 'S-002', assignee: 'Maria Santos', system: 'Nueces Bay Pipeline System' },
      { id: 'WO-3', status: 'in_progress', assigneeId: 'S-001', assignee: 'Raymond Rangel', system: 'Nueces Bay Pipeline System' },
      { id: 'WO-4', status: 'completed', assigneeId: 'S-001', assignee: 'Raymond Rangel', system: 'Other System' },
      { id: 'WO-5', status: 'Completed', assigneeId: 'S-003', assignee: 'James Cooper', system: 'Nueces Bay Pipeline System' },
      { id: 'WO-6', status: 'Complated=Yes', assigneeId: 'S-004', assignee: 'Ana Reyes', system: 'Nueces Bay Pipeline System' },
      { id: 'WO-7', status: 'In progress . San Patricio County, Texas', assigneeId: 'S-001', system: 'Nueces Bay Pipeline System' },
    ];

    it('returns all when no filter', () => {
      assert.equal(listWorkOrders(wos).length, 7);
      assert.equal(listWorkOrders(wos, {}).length, 7);
      assert.equal(listWorkOrders(wos, null).length, 7);
    });
    it('filter by status exact (normalized)', () => {
      assert.deepEqual(listWorkOrders(wos, { status: 'draft' }).map(w => w.id), ['WO-1']);
      assert.deepEqual(listWorkOrders(wos, { status: 'completed' }).map(w => w.id).sort(), ['WO-4', 'WO-5', 'WO-6']);
      assert.deepEqual(listWorkOrders(wos, { status: 'in_progress' }).map(w => w.id).sort(), ['WO-3', 'WO-7']);
    });
    it('filter by status handles legacy typo Complated', () => {
      assert.deepEqual(listWorkOrders(wos, { status: 'Complated' }).map(w => w.id).sort(), ['WO-4', 'WO-5', 'WO-6']);
      assert.deepEqual(listWorkOrders(wos, { status: 'Completed' }).map(w => w.id).sort(), ['WO-4', 'WO-5', 'WO-6']);
    });
    it('filter by assigneeId', () => {
      assert.deepEqual(listWorkOrders(wos, { assigneeId: 'S-001' }).map(w => w.id).sort(), ['WO-1', 'WO-3', 'WO-4', 'WO-7']);
      assert.deepEqual(listWorkOrders(wos, { assigneeId: 's-001' }).map(w => w.id).sort(), ['WO-1', 'WO-3', 'WO-4', 'WO-7']); // case-insensitive
    });
    it('filter by assignee alias also works', () => {
      assert.deepEqual(listWorkOrders(wos, { assignee: 'Raymond Rangel' }).map(w => w.id).sort(), ['WO-1', 'WO-3', 'WO-4']);
    });
    it('filter by system', () => {
      assert.deepEqual(listWorkOrders(wos, { system: 'Other System' }).map(w => w.id), ['WO-4']);
      assert.equal(listWorkOrders(wos, { system: 'Nueces Bay Pipeline System' }).length, 6);
      assert.equal(listWorkOrders(wos, { system: 'nueces bay pipeline system' }).length, 6); // case-insensitive
    });
    it('combines filters', () => {
      const out = listWorkOrders(wos, { status: 'in_progress', assigneeId: 'S-001' });
      assert.deepEqual(out.map(w => w.id).sort(), ['WO-3', 'WO-7']);
      assert.deepEqual(listWorkOrders(wos, { status: 'completed', system: 'Other System' }).map(w => w.id), ['WO-4']);
    });
    it('handles invalid input gracefully', () => {
      assert.deepEqual(listWorkOrders(null), []);
      assert.deepEqual(listWorkOrders(undefined, { status: 'draft' }), []);
      assert.deepEqual(listWorkOrders([], { status: 'draft' }), []);
    });
    it('returns copy (not same reference)', () => {
      const out = listWorkOrders(wos);
      assert.notEqual(out, wos);
    });
  });
});
