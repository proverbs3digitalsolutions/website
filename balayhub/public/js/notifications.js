// Installable app + push notifications on this device.

import { get, post, patch } from './api.js';
import { h, toast } from './ui.js';

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
window.addEventListener('appinstalled', () => { installEvent = null; });

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works */ });
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function deviceName() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'Android' : isIos() ? 'iPhone/iPad' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Computer';
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

function urlKey(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Called on logout so a shared phone stops getting this person's notifications.
export async function forgetThisDevice() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  } catch { /* ignore */ }
}

export async function notificationsCard(rerender) {
  const s = await get('/push/settings');
  const sub = await currentSubscription().catch(() => null);
  const on = Boolean(sub) && Notification.permission === 'granted';

  const enable = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') {
        toast('Notifications are blocked for BalayHub in this browser. Allow them in the browser\'s site settings, then try again.', 'error');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(s.public_key) });
      await post('/push/subscribe', { subscription: fresh.toJSON(), device: deviceName() });
      toast('Notifications are on for this device.');
      rerender();
    } catch (err) {
      toast(err.status ? err.message : 'This browser could not turn on notifications. Private or incognito windows can\'t receive them; open BalayHub in a normal window and try again.', 'error');
    }
  };
  const disable = async () => { await forgetThisDevice(); toast('Notifications are off for this device.'); rerender(); };
  const test = async () => {
    try { const r = await post('/push/test'); toast(r.sent ? 'Test sent. It should appear in a few seconds.' : 'Could not reach your devices. Turn notifications off and on again.'); } catch (err) { toast(err.message, 'error'); }
  };
  // A switch whose save fails goes back to where it was.
  const toggle = async (input, key) => {
    const value = input.checked;
    try { await patch('/push/settings', { [key]: value }); toast('Saved.'); } catch (err) { input.checked = !value; toast(err.message, 'error'); }
  };

  // A long-term workspace has no alert types. Its card says so, and it gets no stay-only sentence.
  const noTypes = s.types.length === 0;
  let status;
  if (!supported()) {
    status = isIos() && !standalone()
      ? h('p', { class: 'muted' }, 'On iPhone and iPad, first add BalayHub to your Home Screen: tap Share, then "Add to Home Screen". Open BalayHub from the new icon and come back here to turn on notifications.')
      : h('p', { class: 'muted' }, 'This browser does not support notifications. Try Chrome, Edge, Firefox or Safari.');
  } else {
    const intro = on ? 'Notifications are on for this device.'
      : noTypes ? null
        : 'Get a notification on this device for new bookings, guest messages and payments, even when BalayHub is closed.';
    // With no alert types there is nothing to turn on or test. A device that is already on can still be turned off.
    const main = noTypes ? null
      : on ? h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: test }, 'Send a test')
        : h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: enable }, 'Turn on notifications');
    status = h('div', null,
      intro && h('p', { class: 'muted' }, intro),
      (main || on) && h('div', { class: 'chips' },
        main,
        on && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: disable }, 'Turn off on this device')));
  }

  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'App & notifications')),
    !standalone() && installEvent && h('p', null,
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: async () => {
        const e = installEvent; installEvent = null;
        e.prompt();
        await e.userChoice.catch(() => null);
        rerender();
      } }, 'Install BalayHub on this device')),
    !standalone() && !installEvent && !isIos() && h('p', { class: 'muted small' }, 'Tip: add BalayHub to your home screen from your browser menu (⋮ → Add to Home screen / Install app) so it opens like an app.'),
    status,
    s.devices.length > 0 && h('p', { class: 'muted small' }, `Turned on for: ${s.devices.map((d) => d.device || 'a device').join(', ')}`),
    noTypes
      ? h('p', { class: 'muted' }, 'Alerts for monthly rentals aren’t available yet.')
      : h('fieldset', { class: 'checks notify-list', style: { border: 0, padding: 0, margin: '12px 0 0' } },
        h('legend', { class: 'small' }, 'Notify me about'),
        s.types.map((t) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: t.on, onchange: (e) => toggle(e.target, t.key) }),
          h('span', null, t.label)))));
}
