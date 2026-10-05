// fixtures.js — ESM loader for fixtures.json, no DOM
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Try ESM json import first; fallback to readFileSync for test env compatibility
let _data;
try {
  const require = createRequire(import.meta.url);
  _data = require('./fixtures.json');
} catch {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const raw = readFileSync(join(__dirname, 'fixtures.json'), 'utf8');
  _data = JSON.parse(raw);
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function loadFixtures() {
  return clone(_data);
}

export function getClient() {
  return clone(_data.client);
}

export function getStaff() {
  return clone(_data.staff);
}

export function getWorkOrders() {
  return clone(_data.workOrders);
}

export function getPipelines() {
  return clone(_data.pipelines);
}

export function getStaffById(id) {
  return clone(_data.staff.find(s => s.id === id) ?? null);
}

export function getWorkOrderById(id) {
  return clone(_data.workOrders.find(w => w.id === id) ?? null);
}

export function getPipelineById(id) {
  return clone(_data.pipelines.find(p => p.id === id) ?? null);
}

export default {
  loadFixtures,
  getClient,
  getStaff,
  getWorkOrders,
  getPipelines,
  getStaffById,
  getWorkOrderById,
  getPipelineById,
};
