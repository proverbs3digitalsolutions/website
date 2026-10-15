// The nightly-rate check: a rate above the ceiling is asked about before it is saved, never refused (QA round 12, D-88).

import { confirmDialog, peso, parseAmount } from './ui.js';

export const HIGH_NIGHTLY_RATE = 50000;

// Resolves true when the save may go ahead. A rate at or under the ceiling, or text that is not a number, goes ahead
// without a question. "Change it" (or closing the question) resolves false and nothing is saved.
export async function highRateOk(amount) {
  const n = parseAmount(amount);
  if (!Number.isFinite(n) || n <= HIGH_NIGHTLY_RATE) return true;
  return Boolean(await confirmDialog({
    title: 'Check the nightly rate', text: `This is ${peso(n)} a night. Save anyway?`, confirmText: 'Save anyway', cancelText: 'Change it',
  }));
}

// A booking total that works out above the ceiling a night asks the same question (QA round 13). 60,000 for 2 nights
// is 30,000 a night and goes ahead.
export async function highStayTotalOk(total, nights) {
  if (!Number.isFinite(total) || !Number.isInteger(nights) || nights < 1 || total / nights <= HIGH_NIGHTLY_RATE) return true;
  return Boolean(await confirmDialog({
    title: 'Check the total',
    text: `This is ${peso(total / nights)} a night (${peso(total)} for ${nights} night${nights === 1 ? '' : 's'}). Save anyway?`,
    confirmText: 'Save anyway', cancelText: 'Change it',
  }));
}

// An add-on price above the same ceiling asks before it is saved (QA round 13).
export async function highAddonPriceOk(amount) {
  const n = parseAmount(amount);
  if (!Number.isFinite(n) || n <= HIGH_NIGHTLY_RATE) return true;
  return Boolean(await confirmDialog({
    title: 'Check the price', text: `This add-on costs ${peso(n)}. Save anyway?`, confirmText: 'Save anyway', cancelText: 'Change it',
  }));
}
