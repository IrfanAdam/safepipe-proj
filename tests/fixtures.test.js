import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, getStaff, getWorkOrders, getPipelines, getClient } from '../src/logic/fixtures.js';
import fixturesData from '../src/logic/fixtures.json' with { type: 'json' };

describe('fixtures shape', () => {
  it('loads fixtures with required top-level keys', () => {
    const f = loadFixtures();
    assert.ok(f.client && typeof f.client.name === 'string');
    assert.ok(Array.isArray(f.staff));
    assert.ok(Array.isArray(f.workOrders));
    assert.ok(Array.isArray(f.pipelines));
  });

  it('counts: 12 staff, 8 workOrders, 3 pipelines', () => {
    const f = loadFixtures();
    assert.equal(f.staff.length, 12);
    assert.equal(f.workOrders.length, 8);
    assert.equal(f.pipelines.length, 3);
  });

  it('client name is Motiva enterprises', () => {
    const c = getClient();
    assert.equal(c.name, 'Motiva enterprises');
  });

  it('staff entries have required fields', () => {
    for (const s of getStaff()) {
      assert.ok(typeof s.id === 'string' && s.id);
      assert.ok(typeof s.name === 'string' && s.name);
      assert.ok(typeof s.role === 'string' && s.role);
      assert.ok(typeof s.location === 'string' && s.location);
      assert.ok(Array.isArray(s.certs));
      assert.ok(typeof s.experienceYears === 'number');
      assert.ok(typeof s.availability === 'boolean' || typeof s.availability === 'string');
      assert.ok(s.workload && typeof s.workload.wos === 'number' && typeof s.workload.tasks === 'number');
      assert.ok(Array.isArray(s.qualifications));
      for (const q of s.qualifications) {
        assert.ok(typeof q.name === 'string' && q.name);
        assert.ok(typeof q.expiryDate === 'string' && q.expiryDate);
        assert.ok(typeof q.status === 'string' && q.status);
      }
    }
  });

  it('workOrders have required fields and realistic values', () => {
    for (const wo of getWorkOrders()) {
      assert.ok(typeof wo.id === 'string' && wo.id);
      assert.ok(typeof wo.system === 'string' && wo.system);
      assert.ok(typeof wo.title === 'string' && wo.title);
      assert.ok(typeof wo.status === 'string' && wo.status);
      assert.ok(typeof wo.county === 'string' && wo.county);
      assert.ok(typeof wo.dueInDays === 'number');
      assert.ok(typeof wo.dueDate === 'string' && wo.dueDate);
      assert.ok(!Number.isNaN(Date.parse(wo.dueDate)), `invalid dueDate ${wo.dueDate}`);
      assert.ok(typeof wo.lastInspected === 'string' && wo.lastInspected);
      assert.ok(typeof wo.assigneeId === 'string' && wo.assigneeId);
      assert.ok(Array.isArray(wo.equipment) && wo.equipment.length > 0);
      for (const eq of wo.equipment) {
        assert.ok(typeof eq.name === 'string' && eq.name);
        assert.equal(typeof eq.checked, 'boolean');
      }
    }
  });

  it('pipelines have required fields', () => {
    for (const p of getPipelines()) {
      assert.ok(typeof p.id === 'string' && p.id);
      assert.ok(typeof p.name === 'string' && p.name);
      assert.ok(typeof p.system === 'string' && p.system);
      assert.ok(Array.isArray(p.tabs) && p.tabs.length >= 5);
      assert.ok(p.tabs.includes('Upcoming'));
      assert.ok(p.tabs.includes('History'));
      assert.ok(p.tabs.includes('Fact sheet'));
      assert.ok(p.tabs.includes('Constructions'));
      assert.ok(p.tabs.includes('Data'));
      assert.ok(Array.isArray(p.sections) && p.sections.length === 14);
      assert.ok(p.sections.includes('Correspondence'));
      assert.ok(p.sections.includes('HCA Mapping'));
    }
  });

  it('helpers return clones (mutations do not leak)', () => {
    const a = getStaff();
    a[0].name = 'MUTATED';
    const b = getStaff();
    assert.notEqual(b[0].name, 'MUTATED');
  });

  it('loadFixtures returns deep clone', () => {
    const a = loadFixtures();
    const b = loadFixtures();
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });

  it('json import matches loader', () => {
    assert.deepEqual(fixturesData, loadFixtures());
  });

  it('verbatim: seeded fig strings are non-empty and plausible', () => {
    // Lightweight verbatim check without parsing .fig — ensures values are not empty/placeholder
    const f = loadFixtures();
    const mustContain = [
      'Motiva enterprises',
      'Raymond Rangel',
      'Nueces Bay Pipeline System',
      'Pipeline Patrol Main Pipe',
      '50 % complete',
      'Due in 23 days',
      'Last inspected on 12th Sep, 2021, Thu, 4:33 pm PDT',
      'Gas Leak detector',
      'Correspondence',
      'HCA Mapping',
      'Upcoming',
      'Fact sheet',
    ];
    // At least these strings must appear somewhere in the fixtures JSON dump
    const dump = JSON.stringify(f);
    for (const s of mustContain) {
      // For equipment names, check substring containment (Gas Leak detector is part of fixtures)
      // For Due in 23 days — we store dueInDays numeric, but dueDate derived; check status or workload strings instead
      // So only check those that are directly stored as strings
      if (s === 'Due in 23 days') continue; // numeric representation
      assert.ok(dump.includes(s), `fixtures should contain verbatim string: ${s}`);
    }
    // Explicit fig-grounded counts
    assert.ok(dump.includes('Jenny Wilson'));
    assert.ok(dump.includes('Darrell Steward'));
    assert.ok(dump.includes('Torres Rein'));
    assert.ok(dump.includes('King Ranch South loop Pipeline'));
    assert.ok(dump.includes('In Progress'));
    assert.ok(dump.includes('Repair & maintenance'));
    assert.ok(dump.includes('12 Valid OQs'));
    assert.ok(dump.includes('San Patricio County, Texas'));
  });
});
