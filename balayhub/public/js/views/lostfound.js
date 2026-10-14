// Lost and found: things guests leave behind, from found to returned or thrown away.

import { get, patch, post, qs } from '../api.js';
import { h, fmtDate, field, formModal, emptyState, pageHead, toast, badge, errorState, skeleton, unitLabel, todayManila } from '../ui.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';

const TABS = [['held', 'Held'], ['returned', 'Returned'], ['disposed', 'Disposed'], ['all', 'All']];
const STATUS_TEXT = { held: 'Held', returned: 'Returned', disposed: 'Disposed' };
const STATUS_BADGE = { held: 'open', returned: 'resolved', disposed: 'cancelled' };

export async function lostFoundView(el, { query = {} } = {}) {
  const defaults = { status: 'held', q: '' };
  const filters = initFilters('lost-found', query, defaults);
  if (!TABS.some(([s]) => s === filters.status)) filters.status = 'held';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const box = h('div', { 'aria-live': 'polite' }, skeleton(3));

  const resolve = (it, status) => formModal({
    title: status === 'returned' ? `Returned: ${it.description}` : `Disposed: ${it.description}`, submitText: status === 'returned' ? 'Mark returned' : 'Mark disposed',
    fields: [field({ name: 'status_note', label: status === 'returned' ? 'How it got back (optional)' : 'What happened (optional)', placeholder: status === 'returned' ? 'e.g. Picked up by guest on 5 Nov' : 'e.g. Donated after 30 days', maxlength: 300 })],
    onSubmit: async (d) => { await patch(`/lost-found/${it.item_id}`, { status, status_note: d.status_note || undefined }); toast(status === 'returned' ? 'Marked returned.' : 'Marked disposed.'); load(); },
  });
  const reopen = async (it) => { try { await patch(`/lost-found/${it.item_id}`, { status: 'held' }); toast('Back to held.'); load(); } catch (err) { toast(err.message, 'error'); } };
  // Logged straight on a listing, for an item found with no stay or cleaning job to attach it to.
  const addItem = async () => {
    const { listings } = await get('/listings');
    formModal({
      title: 'Add lost item', submitText: 'Save item',
      fields: [
        field({ name: 'unit_id', label: 'Listing', type: 'select', required: true, options: listings.map((l) => [l.unit_id, `${unitLabel(l.unit_name)} · ${l.property_name}`]) }),
        field({ name: 'description', label: 'Item', required: true, maxlength: 300, placeholder: 'e.g. Blue umbrella' }),
        field({ name: 'found_where', label: 'Where found', maxlength: 200, placeholder: 'e.g. Lobby, under the sofa' }),
        field({ name: 'found_on', label: 'Date found', type: 'date', value: todayManila() }),
      ],
      onSubmit: async (d) => { await post('/lost-found', d); toast('Lost item recorded.'); load(); },
    });
  };

  async function load() {
    history.replaceState(null, '', `#/lost-found${qs(changed(filters, defaults))}`);
    tabs.replaceChildren(...TABS.map(([s, text]) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(filters.status === s), onclick: () => { filters.status = s; rememberFilters('lost-found', filters); load(); } }, text)));
    let items;
    try { ({ items } = await get(`/lost-found${qs({ status: filters.status === 'all' ? '' : filters.status, q: filters.q })}`)); } catch (err) { box.replaceChildren(errorState(err, load)); return; }
    if (!items.length) {
      box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'inbox', title: filters.q ? 'No results found' : filters.status === 'held' ? 'Nothing is being held' : 'Nothing here', text: filters.q ? 'Try a different search.' : 'Cleaners log found items from the cleaning job, and you can add one from a reservation.' })));
      return;
    }
    box.replaceChildren(h('div', { class: 'card card--flush' }, h('ul', { class: 'list' }, items.map((it) => h('li', { class: 'ops-lf' },
      h('div', { class: 'ops-lf__main' },
        h('span', { class: 'row__title' }, it.description),
        h('span', { class: 'row__sub' }, [it.found_where, it.unit_name && `${unitLabel(it.unit_name)}${it.property_name ? ` · ${it.property_name}` : ''}`, it.found_on && `found ${fmtDate(String(it.found_on).slice(0, 10))}`].filter(Boolean).join(' · ')),
        it.guest_name && h('span', { class: 'row__sub' }, 'Guest: ', it.booking_id ? h('a', { href: `#/reservations/${it.booking_id}` }, it.guest_name) : it.guest_name),
        it.status_note && h('span', { class: 'row__sub' }, it.status_note)),
      h('div', { class: 'ops-lf__end' },
        badge(STATUS_BADGE[it.status] || it.status, STATUS_TEXT[it.status] || it.status),
        it.status === 'held'
          ? h('div', { class: 'ops-lf__actions' },
            h('button', { class: 'btn btn--primary btn--sm', type: 'button', 'aria-label': `Mark returned: ${it.description}`, onclick: () => resolve(it, 'returned') }, 'Returned'),
            h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': `Mark disposed: ${it.description}`, onclick: () => resolve(it, 'disposed') }, 'Disposed'))
          : h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': `Back to held: ${it.description}`, onclick: () => reopen(it) }, 'Back to held')))))));
  }

  el.replaceChildren(pageHead({ title: 'Lost and found', sub: 'Items guests left behind', actions: h('button', { class: 'btn btn--primary', type: 'button', onclick: addItem }, '+ Add item') }), tabs,
    filterBar({ key: 'lost-found', values: filters, defaults, onChange: load, search: { placeholder: 'Search item, place or guest' } }), box);
  await load();
}
