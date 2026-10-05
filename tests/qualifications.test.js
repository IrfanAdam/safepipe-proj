import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expiringOQs, isOQExpired, oqStatus, daysUntilExpiry } from '../src/logic/qualifications.js';

// Fixed now for deterministic tests
const NOW = new Date('2026-01-15T12:00:00Z');
function isoOffset(days) {
  const d = new Date(NOW.getTime() + days * 86400000);
  return d.toISOString();
}

describe('qualifications — fig-grounded OQ expiry', () => {
  // Evidence cited in module header: "Qualification expires in 1m" (10 hits),
  // "12 Valid OQs", Status=Compliant/Grace period/Non Compliant

  describe('isOQExpired', () => {
    it('returns true when expiry is in the past', () => {
      assert.equal(isOQExpired({ expiryDate: isoOffset(-1) }, NOW), true);
      assert.equal(isOQExpired({ expiryDate: isoOffset(-30) }, NOW), true);
    });
    it('returns false when expiry is today or future', () => {
      assert.equal(isOQExpired({ expiryDate: isoOffset(0) }, NOW), false);
      assert.equal(isOQExpired({ expiryDate: isoOffset(5) }, NOW), false);
    });
    it('handles raw date string and Date object', () => {
      assert.equal(isOQExpired(isoOffset(-2), NOW), true);
      assert.equal(isOQExpired(new Date(NOW.getTime() - 86400000), NOW), true);
    });
    it('returns false for missing/invalid oq', () => {
      assert.equal(isOQExpired(null, NOW), false);
      assert.equal(isOQExpired({}, NOW), false);
      assert.equal(isOQExpired({ expiryDate: 'invalid' }, NOW), false);
    });
  });

  describe('oqStatus — mirrors Status/Compliant/Grace/Non Compliant', () => {
    it('valid: >30 days out (Compliant / Due 30<)', () => {
      assert.equal(oqStatus({ expiryDate: isoOffset(31) }, NOW), 'valid');
      assert.equal(oqStatus({ expiryDate: isoOffset(90) }, NOW), 'valid');
      assert.equal(oqStatus({ expiryDate: isoOffset(400) }, NOW), 'valid');
    });
    it('expiring: 0..30 days (Due <30 / expires in 1m)', () => {
      assert.equal(oqStatus({ expiryDate: isoOffset(0) }, NOW), 'expiring');
      assert.equal(oqStatus({ expiryDate: isoOffset(1) }, NOW), 'expiring');
      assert.equal(oqStatus({ expiryDate: isoOffset(15) }, NOW), 'expiring');
      assert.equal(oqStatus({ expiryDate: isoOffset(30) }, NOW), 'expiring');
    });
    it('grace: within 30d after expiry (Grace period)', () => {
      assert.equal(oqStatus({ expiryDate: isoOffset(-1) }, NOW), 'grace');
      assert.equal(oqStatus({ expiryDate: isoOffset(-15) }, NOW), 'grace');
      assert.equal(oqStatus({ expiryDate: isoOffset(-30) }, NOW), 'grace');
    });
    it('expired: beyond 30d past expiry (Non Compliant / Out of Compliance)', () => {
      assert.equal(oqStatus({ expiryDate: isoOffset(-31) }, NOW), 'expired');
      assert.equal(oqStatus({ expiryDate: isoOffset(-90) }, NOW), 'expired');
    });
    it('handles raw string input', () => {
      assert.equal(oqStatus(isoOffset(60), NOW), 'valid');
      assert.equal(oqStatus(isoOffset(-40), NOW), 'expired');
    });
    it('defaults invalid date to valid', () => {
      assert.equal(oqStatus({ expiryDate: 'not-a-date' }, NOW), 'valid');
      assert.equal(oqStatus({}, NOW), 'valid');
    });
  });

  describe('daysUntilExpiry helper', () => {
    it('computes ceil days', () => {
      assert.equal(daysUntilExpiry(isoOffset(1), NOW), 1);
      assert.equal(daysUntilExpiry(isoOffset(0), NOW), 0);
      assert.equal(daysUntilExpiry(isoOffset(-1), NOW), -1);
    });
  });

  describe('expiringOQs — Qualification expires in 1m (withinDays=30)', () => {
    // Fixture staff using industry OQ names found in fig: Veriforce, NCCER, eWebOQ, Worldnet
    const staffList = [
      {
        id: 'S-001',
        name: 'Raymond Rangel',
        qualifications: [
          { name: 'Veriforce - Place and Maintain Permanent Line Markers', provider: 'Veriforce', expiryDate: isoOffset(10) },
          { name: 'NCCER - Pipeline Maintenance', provider: 'NCCER', expiryDate: isoOffset(40) },
          { name: 'eWebOQ - Cathodic protection', provider: 'eWebOQ', expiryDate: isoOffset(-5) }, // grace, not expiring
          { name: 'Worldnet - Leakage Survey', provider: 'Worldnet', expiryDate: isoOffset(90) },
        ],
      },
      {
        id: 'S-002',
        name: 'Maria Santos',
        qualifications: [
          { name: 'Veriforce - EWN-CBT-Install, Inspect, and Maintain Permanent Marker (14.2)', provider: 'Veriforce', expiryDate: isoOffset(1) },
          { name: 'NCCER - Welding Inspection', provider: 'NCCER', expiryDate: isoOffset(25) },
        ],
      },
      {
        id: 'S-003',
        name: 'David Kim',
        qualifications: [
          { name: 'Worldnet - Patrol Main Pipe', provider: 'Worldnet', expiryDate: isoOffset(-40) }, // expired beyond grace
        ],
      },
      {
        name: 'No ID Staff', // fallback to name as staffId
        qualifications: [
          { name: 'Veriforce - ROW Patrol', expiryDate: isoOffset(5) },
        ],
      },
    ];

    it('default withinDays=30 returns only OQs expiring in 0..30 days, sorted', () => {
      const out = expiringOQs(staffList, 30, NOW);
      // Should include: S-001 Veriforce 10d, S-002 Veriforce 1d, S-002 NCCER 25d, No ID Staff 5d
      // Excludes: S-001 NCCER 40d, Worldnet 90d, grace -5, expired -40
      assert.equal(out.length, 4);
      // sorted by days asc: 1,5,10,25
      assert.deepEqual(out.map(r => r.daysUntilExpiry), [1, 5, 10, 25]);
      assert.equal(out[0].staffId, 'S-002');
      assert.equal(out[1].staffId, 'No ID Staff');
      assert.equal(out[2].oq.name, 'Veriforce - Place and Maintain Permanent Line Markers');
    });

    it('withinDays filter is inclusive', () => {
      const out = expiringOQs(staffList, 10, NOW);
      // 1,5,10 qualify; 25 excluded
      assert.equal(out.length, 3);
      assert.deepEqual(out.map(r => r.daysUntilExpiry), [1, 5, 10]);
    });

    it('withinDays=0 only today', () => {
      const list = [{ id: 'X', qualifications: [{ name: 'Test', expiryDate: isoOffset(0) }, { name: 'Test2', expiryDate: isoOffset(1) }] }];
      assert.equal(expiringOQs(list, 0, NOW).length, 1);
    });

    it('returns empty for empty or invalid input', () => {
      assert.deepEqual(expiringOQs([], 30, NOW), []);
      assert.deepEqual(expiringOQs(null, 30, NOW), []);
      assert.deepEqual(expiringOQs([{ id: 'X', qualifications: [] }], 30, NOW), []);
    });

    it('supports oqs and certs alias fields + handles numeric certs gracefully', () => {
      const mixed = [
        { id: 'M1', oqs: [{ name: 'Veriforce', expiryDate: isoOffset(20) }] },
        { id: 'M2', certs: 14 }, // legacy numeric from fixtures.json — should be ignored, not crash
        { id: 'M3', certs: [{ name: 'NCCER', expiryDate: isoOffset(5) }] }, // array form
      ];
      const out = expiringOQs(mixed, 30, NOW);
      assert.equal(out.length, 2);
      assert.equal(out[0].staffId, 'M3'); // 5d before 20d
      assert.equal(out[1].staffId, 'M1');
    });

    it('does not include grace/expired OQs even within window', () => {
      const graceList = [{ id: 'G', qualifications: [{ name: 'Grace OQ', expiryDate: isoOffset(-10) }] }];
      assert.equal(expiringOQs(graceList, 30, NOW).length, 0);
    });
  });
});
