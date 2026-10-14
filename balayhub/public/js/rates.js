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
