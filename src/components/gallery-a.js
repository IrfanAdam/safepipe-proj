/* Gallery lane A — mount for Tab, Tag, Button, Field, Status, Header.
 * Mount-only: renders every lane-A component in all variants/states
 * into #gallery. No visual restyling. */
import { Tab } from './tab.js';
import { Tag } from './tag.js';
import { Button } from './button.js';
import { Field } from './field.js';
import { Status } from './status.js';
import { Header } from './header.js';

const section = (title, body) =>
  `<section data-lane="a" data-section="${title}"><h2>${title}</h2><div>${body}</div></section>`;

const tablist = (tabs) => `<div role="tablist" aria-label="Gallery tabs">${tabs}</div>`;

const html = [
  section(
    'Tab',
    [
      tablist(
        Tab({ label: 'Overview', variant: 'pill', selected: true }) +
          Tab({ label: 'Activity', variant: 'pill', dot: true }) +
          Tab({ label: 'Files', variant: 'pill' }) +
          Tab({ label: 'Disabled', variant: 'pill', disabled: true }),
      ),
      tablist(
        Tab({ label: 'Dashboard', variant: 'underline', size: 'medium', selected: true }) +
          Tab({ label: 'Reports', variant: 'underline', size: 'medium' }) +
          Tab({ label: 'Settings', variant: 'underline', size: 'large' }) +
          Tab({ label: 'Audit', variant: 'underline', size: 'large', selected: true }),
      ),
      tablist(
        Tab({ label: 'Day', variant: 'floating', selected: true }) +
          Tab({ label: 'Week', variant: 'floating' }) +
          Tab({ label: 'Off', variant: 'floating', disabled: true }),
      ),
    ].join(''),
  ),
  section(
    'Tag',
    [
      Tag({ label: 'Default' }),
      Tag({ label: 'Selected', variant: 'inverse', selected: true }),
      Tag({ label: 'Veriforce', variant: 'provider', count: '32' }),
      Tag({ label: 'Eweb', variant: 'provider', tone: 'danger' }),
      Tag({ label: '+2 more', variant: 'overflow' }),
      Tag({ label: 'Non Compliant', variant: 'status', tone: 'danger' }),
      Tag({ label: 'Grace period', variant: 'status', tone: 'warning' }),
      Tag({ label: 'Compliant', variant: 'status', tone: 'success' }),
      Tag({ label: 'Liquid', variant: 'toggle', pressed: true }),
      Tag({ label: 'Work Order', variant: 'toggle', pressed: false }),
      Tag({ label: 'Archived', disabled: true }),
    ].join(''),
  ),
  section(
    'Button',
    [
      Button({ label: 'Save changes', variant: 'primary' }),
      Button({ label: 'Cancel', variant: 'neutral' }),
      Button({ label: 'Add to a Crew', variant: 'ghost', icon: '+' }),
      Button({ label: 'Delete', variant: 'danger' }),
      Button({ label: 'Close', variant: 'neutral', iconOnly: true, icon: 'x' }),
      Button({ label: 'Saving', variant: 'primary', loading: true }),
      Button({ label: 'Unavailable', variant: 'primary', disabled: true }),
    ].join(''),
  ),
  section(
    'Field',
    [
      Field({ label: 'Site name', id: 'g-site', placeholder: 'e.g. North compressor', size: 'small' }),
      Field({ label: 'Operator', id: 'g-op', value: 'Acme Energy', size: 'small', trailingIcon: 'v' }),
      Field({ label: 'Description', id: 'g-desc', value: 'Line 12 inspection', size: 'medium' }),
      Field({ label: 'Notes', id: 'g-notes', variant: 'textarea', placeholder: 'Add context', value: '' }),
      Field({ label: 'Due date', id: 'g-due', variant: 'date', value: '2026-11-01' }),
      Field({ label: 'Segment', id: 'g-ro', variant: 'readonly', value: 'SEG-042' }),
      Field({ label: 'Pressure', id: 'g-err', value: 'abc', error: 'Enter a number in psi.' }),
      Field({ label: 'Locked', id: 'g-dis', value: 'read only', disabled: true }),
    ].join(''),
  ),
  section(
    'Status',
    [
      Status({ label: 'Compliant', tone: 'success' }),
      Status({ label: 'Non Compliant', tone: 'danger' }),
      Status({ label: 'Grace period', tone: 'warning' }),
      Status({ label: 'Due <30', tone: 'warning', qualifier: '12 segments' }),
      Status({ label: 'Data upload', tone: 'accent' }),
      Status({ label: 'Incomplete', tone: 'neutral' }),
      Status({ label: 'Syncing', tone: 'info', pending: true }),
      Status({ label: 'Offline', tone: 'neutral', disabled: true }),
      Status({ label: 'Active', variant: 'toggle', active: true }),
      Status({ label: 'Inactive', variant: 'toggle', active: false }),
      Status({
        label: 'Line 12', qualifier: '3 open items', tone: 'danger', variant: 'card',
        tags: [
          { label: 'Non Compliant', variant: 'status', tone: 'danger' },
          { label: 'Liquid' },
          { label: '+2 more', variant: 'overflow' },
        ],
        action: '>',
      }),
      Status({
        label: 'North spur', qualifier: 'rail view', tone: 'success', variant: 'card-vertical',
        tags: [{ label: 'Compliant', variant: 'status', tone: 'success' }],
      }),
    ].join(''),
  ),
  section(
    'Header',
    [
      Header({
        variant: 'appbar', brand: 'Safepipe', date: 'Oct 5, 2026',
        actions: [{ label: 'Search', icon: 'S' }, { label: 'Alerts', icon: '!' }],
        avatar: 'OP',
      }),
      Header({
        variant: 'section', overline: 'Network overview', title: 'Pipeline integrity',
        meta: [{ value: '42', qualifier: 'segments' }, { value: '98%', qualifier: 'compliant' }],
        date: 'Oct 4, 2026',
      }),
      Header({
        variant: 'toolbar', searchPlaceholder: 'Search work orders',
        actions: [{ label: 'Filter', icon: 'F' }, { label: 'Add', icon: '+' }],
      }),
    ].join(''),
  ),
].join('');

const root = document.getElementById('gallery');
if (root) root.insertAdjacentHTML('beforeend', html);
