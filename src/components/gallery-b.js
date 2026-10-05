/* Gallery lane B — mount for components 7-12 (sidebar, card, modal, search-filter, progress, list-row). Mount-only: no visual restyling. */
import { Sidebar } from './sidebar.js';
import { Card } from './card.js';
import { Modal } from './modal.js';
import { SearchFilter } from './search-filter.js';
import { Progress } from './progress.js';
import { ListRow } from './list-row.js';

const navItems = [
  { id: 'workforce', label: 'Workforce', icon: '◈' },
  { id: 'operations', label: 'Operations', icon: '⬢' },
  { id: 'assets', label: 'Assets', icon: '▣' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
  { id: 'reports', label: 'Reports', icon: '▤', disabled: true },
];
const pills = [
  { label: 'All', selected: false },
  { label: 'Operations', selected: true },
  { label: 'Assets', selected: false },
  { label: 'Overdue', selected: true },
];

const sections = [
  `<section class="spc-lane"><h1>Lane B — Sidebar</h1>${['workforce', 'operations', 'assets', 'settings'].map((a) => Sidebar({ items: navItems, active: a })).join('')}${Sidebar({ items: navItems, active: 'workforce', state: 'disabled' })}</section>`,
  `<section class="spc-lane"><h1>Lane B — Card</h1>${Card({ title: 'Background shell', variant: 'background' })}${Card({ title: 'WO-1042 · Patrol Main Pipe', subtitle: 'Nueces Bay · due Fri', tags: ['OQ', 'Crew 7'], progress: 45, footer: 'Assigned to J. Rivera', action: '↗', variant: 'inspection' })}${Card({ title: 'Selected card', subtitle: 'meta line', variant: 'inspection', selected: true })}${Card({ title: 'Disabled card', variant: 'inspection', disabled: true })}${Card({ title: 'Loading card', variant: 'inspection', loading: true })}${Card({ title: 'Error card', variant: 'inspection', error: 'You are not qualified to edit' })}${Card({ variant: 'split-stat', stats: [{ value: '22', label: 'Done' }, { value: '11', label: 'Pending' }] })}${Card({ title: 'Monthly report', body: 'Grading rollup for September.', variant: 'report' })}${Card({ title: 'KPI tile', body: 'Body 1 · 146 inspections', variant: 'dashboard' })}</section>`,
  `<section class="spc-lane"><h1>Lane B — Modal</h1>${Modal({ title: 'Import OQ data', subtitle: 'Upload a CSV to continue', body: '<p>Tabs + upload controls go here.</p>', size: 'medium', id: 'm-medium' })}${Modal({ title: 'Edit asset', subtitle: 'Two-column field grid', body: '<p>Field grid goes here.</p>', size: 'large', id: 'm-large' })}${Modal({ title: 'Confirm delete?', body: '<p>This cannot be undone.</p>', size: 'compact', id: 'm-compact' })}${Modal({ title: 'Data review', body: '<p>Wide layout preview.</p>', size: 'wide', id: 'm-wide' })}${Modal({ title: 'Submitting…', body: '<p>Please wait.</p>', size: 'medium', loading: true, id: 'm-loading' })}${Modal({ title: 'Fix errors', body: '<p>Check the file.</p>', size: 'medium', error: 'Upload failed: bad header row.', id: 'm-error' })}${Modal({ title: 'Hidden dialog', size: 'medium', open: false, id: 'm-closed' })}</section>`,
  `<section class="spc-lane"><h1>Lane B — Search / Filter</h1>${SearchFilter({ placeholder: 'Search workstreams…', filters: pills, id: 'sf-default' })}${SearchFilter({ placeholder: 'Quiet variant', quiet: true, filters: [{ label: 'Idle', selected: false }], id: 'sf-quiet' })}${SearchFilter({ placeholder: 'Disabled…', disabled: true, filters: [], id: 'sf-disabled' })}${SearchFilter({ placeholder: 'Search…', filters: pills, error: 'Query failed: try again.', id: 'sf-error' })}${SearchFilter({ placeholder: 'Typed value', value: 'patrol', filters: pills, id: 'sf-value' })}</section>`,
  `<section class="spc-lane"><h1>Lane B — Progress</h1>${Progress({ value: 106, max: 237, variant: 'violet', title: 'OQs acquired', doneLabel: '106 of 237' })}${Progress({ value: 106, max: 237, variant: 'sky', title: 'Brand restatement', doneLabel: '106 of 237' })}${Progress({ value: 22, max: 33, variant: 'card', title: 'Qualifications', action: 'View all', doneLabel: '22 out of 33 OQs acquired', pendingLabel: '11 pending' })}${Progress({ value: 220, max: 237, variant: 'violet', title: 'Complete', knob: true, complete: true, doneLabel: '220 of 237' })}${Progress({ value: 5, max: 10, variant: 'segmented', title: 'Steps' })}${Progress({ value: 50, max: 100, variant: 'header', title: 'Inspection', doneLabel: '50 % complete', pendingLabel: 'Due Friday' })}${Progress({ value: 30, max: 100, variant: 'violet', title: 'Disabled', disabled: true, doneLabel: '30 of 100' })}${Progress({ value: 30, max: 100, variant: 'card', title: 'Overdue', doneLabel: '30 of 100', pendingLabel: '3 overdue', error: true })}</section>`,
  `<section class="spc-lane"><h1>Lane B — List Row</h1>${ListRow({ title: 'Patrol Main Pipe', meta: '12 Tasks · 32 Crew members', chips: ['OQ', 'Crew'], variant: 'row' })}${ListRow({ title: 'Selected row', meta: '12 Tasks', variant: 'row', selected: true })}${ListRow({ title: 'Workstream group', meta: '33 items', variant: 'collapsed' })}${ListRow({ title: 'ACS-102 · FBE coating', variant: 'dense', icon: '⬣' })}${ListRow({ title: 'ACS-103 · selected', variant: 'dense', selected: true, icon: '⬣' })}${ListRow({ title: 'Valve no : V-221', meta: 'Nueces Bay · inspected Mar', variant: 'record', status: 'OK', expiry: '32 days' })}${ListRow({ title: 'Valve no : V-222', meta: 'selected record', variant: 'record', selected: true })}${ListRow({ variant: 'tile', selected: false })}${ListRow({ title: 'Loading row', variant: 'row', loading: true })}${ListRow({ title: 'Disabled row', meta: 'archived', variant: 'row', disabled: true })}${ListRow({ title: 'Failed row', meta: 'sync error', variant: 'row', errorChip: 'Error' })}</section>`,
];

const root = document.getElementById('gallery');
if (root) root.insertAdjacentHTML('beforeend', sections.join(''));
