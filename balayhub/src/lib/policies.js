'use strict';

// Cancellation policy presets, the refund each one suggests, and how a policy
// is shown to guests (English and Taglish). A suggestion is a starting point
// for the host; this file never moves money.

const PRESETS = {
  flexible: {
    label: 'Flexible',
    en: 'Full refund if you cancel at least 1 day before check-in. No refund after that.',
    tl: 'Buong refund kung mag-cancel ka ng at least 1 araw bago ang check-in. Walang refund pagkatapos nito.',
    tiers: [
      { minDays: 1, percent: 100, rule: 'Full refund: cancelled at least 1 day before check-in' },
      { minDays: -Infinity, percent: 0, rule: 'No refund: cancelled less than 1 day before check-in' },
    ],
  },
  moderate: {
    label: 'Moderate',
    en: 'Full refund if you cancel at least 5 days before check-in. After that, 50% refund.',
    tl: 'Buong refund kung mag-cancel ka ng at least 5 araw bago ang check-in. Pagkatapos nito, 50% refund.',
    tiers: [
      { minDays: 5, percent: 100, rule: 'Full refund: cancelled at least 5 days before check-in' },
      { minDays: -Infinity, percent: 50, rule: '50% refund: cancelled less than 5 days before check-in' },
    ],
  },
  strict: {
    label: 'Strict',
    en: '50% refund if you cancel at least 7 days before check-in. No refund after that.',
    tl: '50% refund kung mag-cancel ka ng at least 7 araw bago ang check-in. Walang refund pagkatapos nito.',
    tiers: [
      { minDays: 7, percent: 50, rule: '50% refund: cancelled at least 7 days before check-in' },
      { minDays: -Infinity, percent: 0, rule: 'No refund: cancelled less than 7 days before check-in' },
    ],
  },
  non_refundable: {
    label: 'Non-refundable',
    en: 'This booking is non-refundable.',
    tl: 'Hindi ma-refund ang booking na ito.',
    tiers: [{ minDays: -Infinity, percent: 0, rule: 'Non-refundable' }],
  },
};

// Same list as the units.cancellation_policy CHECK in migration 027.
const POLICY_KEYS = [...Object.keys(PRESETS), 'custom'];

// Whole days from cancelDate to check-in. Negative once check-in has passed.
const daysBefore = (checkIn, cancelDate) =>
  Math.round((Date.parse(`${checkIn}T00:00:00Z`) - Date.parse(`${cancelDate}T00:00:00Z`)) / 86400000);

// The refund a preset suggests for a cancellation on cancelDate. Money is worked in
// whole centavos, and a half centavo rounds up. Returns null when there is nothing
// to suggest: no preset (unset or custom), or nothing paid.
function suggestRefund(policy, paidAmount, checkIn, cancelDate) {
  const preset = Object.hasOwn(PRESETS, policy) ? PRESETS[policy] : null;
  const paidCentavos = Math.round(Number(paidAmount) * 100);
  if (!preset || !(paidCentavos > 0)) return null;
  const days = daysBefore(checkIn, cancelDate);
  const tier = preset.tiers.find((t) => days >= t.minDays);
  return { percent: tier.percent, amount: (Math.round((paidCentavos * tier.percent) / 100) / 100).toFixed(2), rule: tier.rule };
}

// How a unit's policy is shown: { key, label, en, tl }, or null when nothing is set.
// A custom policy is the host's own wording, so it has no Taglish version (tl is null).
function describePolicy(policy, customText) {
  if (policy === 'custom') return customText ? { key: 'custom', label: 'Custom', en: customText, tl: null } : null;
  if (!Object.hasOwn(PRESETS, policy)) return null;
  const p = PRESETS[policy];
  return { key: policy, label: p.label, en: p.en, tl: p.tl };
}

module.exports = { POLICY_KEYS, suggestRefund, describePolicy };
