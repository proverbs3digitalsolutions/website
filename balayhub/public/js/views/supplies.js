// Supplies per property with par levels. Anything below par is flagged as low.

import { get, post, patch, qs } from '../api.js';
import { h, field, formModal, makeForm, confirmDialog, emptyState, pageHead, toast, errorState, skeleton, openModal, fmtDate, manilaDay, showErrors } from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, changed } from '../filters.js';

const isLow = (s) => Number(s.on_hand) < Number(s.par_level);
const MOVED = { used: 'Used', restocked: 'Added', count: 'Counted' };
const MAX_QTY = 100000; // Matches MAX_QTY in src/routes/supplies.js.

// The unit word for a count: "1 roll", "2 rolls". Units are typed freely, so the singular is a plain
// English guess ("boxes" to "box", "batteries" to "battery"). "pcs" is an abbreviation with its own singular: "1 pc" (#34).
export function unitWord(n, unit) {
  if (Number(n) !== 1) return unit;
  if (unit.toLowerCase() === 'pcs') return 'pc';
  if (/ies$/.test(unit)) return unit.replace(/ies$/, 'y');
  if (/(s|x|z|ch|sh)es$/.test(unit)) return unit.slice(0, -2);
  if (/ss$/i.test(unit)) return unit; // "glass" is already singular
  return unit.replace(/s$/, '');
}
export const qtyLabel = (n, unit) => `${n} ${unitWord(n, unit)}`;

export async function suppliesView(el, { query = {} } = {}) {
  const defaults = { property_id: '', low: '', q: '' };
  const filters = initFilters('supplies', query, defaults);
  const canManage = ['owner', 'manager'].includes(state.user.role);
  const box = h('div', { 'aria-live': 'polite' }, skeleton(3));
  const barBox = h('div');
  let properties = [];
  try { ({ properties } = await get('/properties')); } catch { /* filter stays hidden */ }

  const addOrEdit = (s) => formModal({
    title: s ? `Edit ${s.name}` : 'Add a supply', submitText: s ? 'Save changes' : 'Add supply',
    fields: [
      !s && field({ name: 'property_id', label: 'Property', type: 'select', required: true, value: filters.property_id || (properties.length === 1 ? properties[0].property_id : ''), options: properties.map((p) => [p.property_id, p.property_name]) }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'name', label: 'Item', required: true, value: s?.name, placeholder: 'e.g. Toilet paper', maxlength: 80 }),
        field({ name: 'unit_label', label: 'Counted in', value: s?.unit_label || 'pcs', placeholder: 'pcs, rolls, bottles', maxlength: 20 })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'par_level', label: 'Keep at least', type: 'number', min: 0, step: 1, required: true, msgLabel: 'Low-stock level', value: s?.par_level ?? 0, hint: 'You get a low-stock warning below this.' }),
        !s && field({ name: 'on_hand', label: 'On hand now', type: 'number', min: 0, step: 1, required: true, msgLabel: 'On hand', value: 0 })),
    ],
    onSubmit: async (d) => {
      const body = { name: d.name, unit_label: d.unit_label || 'pcs', par_level: Number(d.par_level) };
      if (s) await patch(`/supplies/${s.supply_id}`, body); else await post('/supplies', { ...body, property_id: d.property_id, on_hand: Number(d.on_hand) });
      toast(s ? 'Supply updated.' : 'Supply added.'); load();
    },
  });

  // Recording more use than is on hand asks first. If the owner goes back, the form stays open.
  const move = (s, kind) => {
    let modal;
    const form = makeForm({
      submitText: 'Save',
      cancel: () => modal.close(),
      fields: [
        h('p', { class: 'muted small' }, `On hand now: ${qtyLabel(s.on_hand, s.unit_label)}. Keep at least ${qtyLabel(s.par_level, s.unit_label)}.`),
        field({ name: 'quantity', label: kind === 'count' ? `How many ${s.unit_label} are there now?` : `How many ${s.unit_label}?`, type: 'number', min: kind === 'count' ? 0 : 1, step: 1, required: true, msgLabel: 'Quantity', value: kind === 'count' ? s.on_hand : '' }),
        field({ name: 'note', label: 'Note (optional)', maxlength: 200 }),
      ],
      onSubmit: async (d) => {
        const quantity = Number(d.quantity);
        // The server takes whole numbers only, so say so before asking about stock (#31).
        if (!Number.isInteger(quantity)) { showErrors(form, { quantity: 'Quantity must be a whole number.' }); return; }
        // The server refuses anything above MAX_QTY, so say so at the field before asking about stock (#21).
        if (quantity > MAX_QTY) { showErrors(form, { quantity: `Quantity must be at most ${MAX_QTY}.` }); return; }
        if (kind === 'used' && s.on_hand > 0 && quantity > s.on_hand && !await confirmDialog({
          title: 'Not enough on hand',
          text: `You asked to record ${qtyLabel(quantity, s.unit_label)} used. On hand is ${qtyLabel(s.on_hand, s.unit_label)}, so only that much is logged as used, and on hand goes to 0.`,
          confirmText: 'Record what is on hand' })) return;
        await post(`/supplies/${s.supply_id}/movements`, { kind, quantity, note: d.note || undefined });
        toast(kind === 'used' ? 'Use recorded.' : 'Stock updated.'); load(); modal.close();
      },
    });
    modal = openModal({ title: { count: 'Count stock', restocked: 'Add stock', used: 'Record use' }[kind] + `: ${s.name}`, body: form });
  };

  async function archive(s) {
    if (!await confirmDialog({ title: `Archive ${s.name}?`, text: 'It disappears from the list and from cleaners. Its history is kept.', confirmText: 'Archive', danger: true })) return;
    try { await post(`/supplies/${s.supply_id}/archive`); toast('Archived.'); load(); } catch (err) { toast(err.message, 'error'); }
  }

  // The last 20 movements on one item, loaded when the dialog opens.
  function showHistory(s) {
    const body = h('div', { 'aria-live': 'polite' });
    const paint = async () => {
      body.replaceChildren(skeleton(2));
      try {
        const { movements } = await get(`/supplies/${s.supply_id}/movements`);
        body.replaceChildren(movements.length
          ? h('ul', { class: 'list' }, movements.map((m) => h('li', { class: 'row' }, h('div', { class: 'row__main' },
            h('span', { class: 'row__title' }, `${MOVED[m.kind]} ${qtyLabel(m.quantity, s.unit_label)}`),
            h('span', { class: 'row__sub' }, `${m.recorded_by_name || 'Someone'} · ${fmtDate(manilaDay(m.created_at))}`),
            m.note && h('span', { class: 'row__sub' }, m.note)))))
          : h('p', { class: 'muted small' }, 'Nothing has been recorded for this item yet.'));
      } catch (err) { body.replaceChildren(errorState(err, paint)); }
    };
    openModal({ title: `History: ${s.name}`, body });
    paint();
  }

  async function load() {
    history.replaceState(null, '', `#/supplies${qs(changed(filters, defaults))}`);
    let supplies;
    try { ({ supplies } = await get(`/supplies${qs({ property_id: filters.property_id, low: filters.low })}`)); } catch (err) {
      box.replaceChildren(errorState(err, load)); return;
    }
    const q = filters.q.toLowerCase();
    if (q) supplies = supplies.filter((s) => s.name.toLowerCase().includes(q));
    if (!supplies.length) {
      const hasFilter = Object.keys(changed(filters, defaults)).length > 0;
      box.replaceChildren(h('div', { class: 'card' }, emptyState({
        iconName: 'inbox', title: hasFilter ? 'No supplies match' : 'No supplies yet',
        text: hasFilter ? 'Try removing a filter.' : 'Track things like toilet paper, soap and trash bags. Cleaners record what they use, and you see what is running low.',
        action: !hasFilter && canManage && h('button', { class: 'btn btn--primary', type: 'button', onclick: () => addOrEdit(null) }, '+ Add supply') })));
      return;
    }
    const groups = new Map();
    supplies.forEach((s) => { const k = s.property_name || 'Property'; groups.set(k, [...(groups.get(k) || []), s]); });
    const low = supplies.filter(isLow).length;
    box.replaceChildren(
      low > 0 && h('div', { class: 'alert alert--warn', role: 'status' }, `${low} item${low === 1 ? ' is' : 's are'} running low.`),
      [...groups].map(([name, list]) => h('div', { class: 'card card--flush ops-card' },
        groups.size > 1 || properties.length > 1 ? h('h2', { class: 'ops-card__title' }, name) : null,
        h('ul', { class: 'list' }, list.map((s) => h('li', { class: `ops-supply${isLow(s) ? ' is-low' : ''}` },
          h('div', { class: 'ops-supply__main' },
            h('span', { class: 'row__title' }, s.name, isLow(s) && h('span', { class: 'ops-low' }, 'Low stock')),
            h('span', { class: 'row__sub' }, `Keep at least ${qtyLabel(s.par_level, s.unit_label)}`)),
          h('div', { class: 'ops-supply__count', 'aria-label': `${qtyLabel(s.on_hand, s.unit_label)} on hand` }, h('strong', null, String(s.on_hand)), h('span', { class: 'muted small' }, ` ${unitWord(s.on_hand, s.unit_label)}`)),
          canManage && h('div', { class: 'ops-supply__actions' },
            h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => move(s, 'restocked'), 'aria-label': `Add stock to ${s.name}` }, 'Add stock'),
            h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => move(s, 'used'), 'aria-label': `Record use of ${s.name}` }, 'Record use'),
            // The rest sit under one disclosure per row, named for its supply (#36, D-81).
            h('details', { class: 'ops-more' },
              h('summary', { class: 'btn btn--secondary btn--sm', 'aria-label': `More for ${s.name}` }, 'More'),
              h('div', { class: 'ops-supply__actions' },
                h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => move(s, 'count'), 'aria-label': `Count ${s.name}` }, 'Count'),
                h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => showHistory(s), 'aria-label': `History of ${s.name}` }, 'History'),
                h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => addOrEdit(s), 'aria-label': `Edit ${s.name}` }, 'Edit'),
                h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => archive(s), 'aria-label': `Archive ${s.name}` }, 'Archive'))))))))));
  }

  barBox.replaceChildren(filterBar({
    key: 'supplies', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search supplies' },
    // Both selects live in the Filters panel so the search box and the button share one row on a phone.
    more: [properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
      { name: 'low', label: 'Stock', all: 'All items', options: [['1', 'Running low']] }].filter(Boolean),
  }));
  el.replaceChildren(pageHead({ title: 'Supplies', sub: 'What you keep stocked, and what is running low',
    actions: canManage && h('button', { class: 'btn btn--primary', type: 'button', onclick: () => addOrEdit(null) }, '+ Add supply') }), barBox, box);
  await load();
}
