// Screens 1–2: Welcome, Sign up / Log in, plus verification, password recovery
// and workspace setup.

import { get, post, ApiError } from '../api.js';
import { h, brand, field, makeForm, badge, toast } from '../ui.js';
import { state, navigate, refreshUser, afterLogin } from '../app.js';
import { tryDemo } from './landing.js';
import { t, tServer, initGuestLang, extendTranslations } from '../i18n.js';

function publicPage(...children) {
  return h('div', { class: 'public' },
    h('header', { class: 'public__top' }, brand('#/')),
    h('main', { class: 'public__main', id: 'main' }, children));
}

function authCard(title, lead, ...body) {
  return h('div', { class: 'auth-card' }, h('h1', null, title), lead && h('p', { class: 'lead' }, lead), body);
}

// Login / sign-up: form on the left, a living-room image on the right (hidden on phones).
function splitPage(...children) {
  return h('div', { class: 'auth-split' },
    h('div', { class: 'auth-split__form' },
      h('header', { class: 'public__top' }, brand('#/')),
      h('main', { class: 'auth-split__main', id: 'main' }, children)),
    h('aside', { class: 'auth-split__art', 'aria-hidden': 'true' },
      h('img', { src: '/img/auth-bahay-kubo.webp', srcset: '/img/auth-bahay-kubo-800.webp 800w, /img/auth-bahay-kubo.webp 1400w', sizes: '(min-width: 880px) 52vw, 100vw', alt: '' }),
      h('div', { class: 'auth-split__caption' },
        h('strong', null, 'Properties. People. A more connected home.'),
        h('span', null, 'Calendar, guests, cleaning, payments and reports for Filipino hosts and property managers.'))));
}

let googleEnabled = null;
export async function googleButton(label, invite) {
  if (googleEnabled === null) {
    try { googleEnabled = (await get('/auth/options')).google; } catch { googleEnabled = false; }
  }
  if (!googleEnabled) return null;
  const href = `/api/auth/google/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;
  return h('div', { class: 'google-block' },
    h('div', { class: 'or-divider' }, h('span', null, 'OR')),
    h('a', { class: 'btn btn--secondary btn--block btn--google', href },
      h('img', { src: '/img/google-g.svg', alt: '', width: 18, height: 18 }), label));
}

const GOOGLE_ERRORS = {
  not_configured: 'Google sign-in is not set up yet. Use your email and password.',
  cancelled: 'Google sign-in was cancelled.',
  expired: 'The Google sign-in took too long or was opened in another tab. Please try again.',
  google_failed: "We couldn't reach Google. Please try again.",
  email_unverified: 'Your Google email address is not verified.',
  revoked: 'This account no longer has access. Contact your workspace owner.',
  mismatch: 'This email is linked to a different Google account. Log in with your password instead.',
  invite_email: 'Sign in with the Google account that matches the email the invitation was sent to.',
};

const devLink = (url, text) => url && h('div', { class: 'alert alert--info' },
  t('Development mode — email is not configured, so here is the link: '), h('a', { href: url.slice(url.indexOf('#')) }, text));

// ---------------------------------------------------------------- Screen 1: Welcome
export async function welcomeView(el) {
  const sample = (name, unit, amount, status) => h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, name), h('span', { class: 'row__sub' }, unit)),
    h('div', { class: 'row__end' }, h('span', { class: 'amount' }, amount), badge(status))));
  el.append(publicPage(h('div', { class: 'welcome' },
    h('div', { class: 'welcome__copy' },
      h('h1', null, 'All your rentals, ', h('span', null, 'one dashboard.')),
      h('p', null, 'BalayHub replaces scattered spreadsheets, notebooks and chat threads. Track properties, tenants, leases, rent, expenses and repairs — and see who has paid at a glance.'),
      h('div', { class: 'welcome__actions' },
        h('a', { class: 'btn btn--primary', href: '#/signup' }, 'Get Started'),
        h('a', { class: 'btn btn--secondary', href: '#/login' }, 'Log in')),
      h('ul', { class: 'welcome__points' },
        h('li', null, 'See occupied and vacant units, rent collected and unpaid balances'),
        h('li', null, 'Record full and partial payments — cash, bank, GCash or Maya'),
        h('li', null, 'Track repair requests and property expenses'),
        h('li', null, 'Monthly income and expense reports you can export'))),
    h('div', { class: 'welcome__preview', 'aria-label': 'Example dashboard' },
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Occupied'), h('div', { class: 'stat__value' }, '42/50')),
        h('div', { class: 'stat stat--good' }, h('div', { class: 'stat__label' }, 'Collected'), h('div', { class: 'stat__value' }, '₱120,000')),
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Properties'), h('div', { class: 'stat__value' }, '12')),
        h('div', { class: 'stat stat--alert' }, h('div', { class: 'stat__label' }, 'Outstanding'), h('div', { class: 'stat__value' }, '₱18,000'))),
      h('ul', { class: 'list' },
        sample('Tenant A', 'Unit 101', '₱8,000', 'paid'),
        sample('Tenant B', 'Unit 205', '₱6,000', 'partial'),
        sample('Tenant C', 'Unit 302', '₱10,000', 'overdue')),
      h('small', null, 'Illustrative example only.')))));
}

// ---------------------------------------------------------------- Screen 2: Log in
export async function loginView(el, { query }) {
  // The "Password updated" note belongs to the first attempt only: it goes on submit, and reset=1 leaves the address.
  let resetNote = query.reset && h('div', { class: 'alert alert--ok' }, 'Password updated. Log in with your new password.');
  const form = makeForm({
    submitText: 'Log in',
    fields: [
      field({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' }),
      field({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' }),
    ],
    onSubmit: async (data) => {
      if (resetNote) {
        resetNote.remove(); resetNote = null;
        try { history.replaceState(null, '', '#/login'); } catch { /* ignore */ }
      }
      const res = await post('/auth/login', data);
      state.user = res.user;
      await refreshUser();
      afterLogin();
    },
  });
  form.querySelector('.form-actions .btn').classList.add('btn--block');
  el.append(splitPage(authCard('Welcome back!', 'Please enter your details to log in.',
    query.expired && h('div', { class: 'alert alert--warn' }, 'Your session expired. Log in again to continue — unsaved form input on this device is kept.'),
    resetNote,
    query.google_error && h('div', { class: 'alert alert--error' }, GOOGLE_ERRORS[query.google_error] || 'Google sign-in failed. Please try again.'),
    form,
    await googleButton('Log in with Google'),
    h('div', { class: 'auth-card__foot' },
      h('p', null, h('a', { href: '#/forgot' }, 'Forgot password?')),
      h('p', null, 'New to BalayHub? ', h('a', { href: '#/signup' }, 'Create an account')),
      h('p', null, 'Are you a unit owner? ', h('a', { href: '#/owner' }, 'Sign in here')),
      h('p', null, 'Just looking? ', h('button', { class: 'linkbtn', type: 'button', onclick: tryDemo }, 'Try the live demo'))))));
}

// ---------------------------------------------------------------- Screen 2: Sign up
export async function signupView(el, { query }) {
  let invite = null;
  if (query.invite) {
    try { invite = await get(`/invitations/${encodeURIComponent(query.invite)}`); } catch (err) {
      el.append(publicPage(authCard('Invitation not valid', null,
        h('div', { class: 'alert alert--error' }, err.message),
        h('p', { class: 'auth-card__foot' }, h('a', { href: '#/signup' }, 'Create your own account instead')))));
      return;
    }
  }
  const privacy = h('div', { class: 'field', dataset: { field: 'accept_privacy' } },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'accept_privacy' }),
      h('span', null, 'I agree to the ', h('a', { href: '#/terms', target: '_blank' }, 'Terms of Service'), ' and have read the ',
        h('a', { href: '#/privacy', target: '_blank' }, 'Privacy Notice'), '.')),
    h('div', { class: 'error', role: 'alert' }));
  const form = makeForm({
    submitText: 'Create account',
    fields: [
      field({ name: 'full_name', label: 'Full name', required: true, autocomplete: 'name', maxlength: 120 }),
      field({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email', value: invite?.email }),
      field({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters.' }),
      field({ name: 'confirm_password', label: 'Confirm password', type: 'password', required: true, autocomplete: 'new-password' }),
      privacy,
    ],
    onSubmit: async (data) => {
      // Checked before the request goes out, so an unticked box never uses up the sign-up limit.
      // Every problem is gathered and shown together, each at its own field.
      const errs = {};
      if ((data.password || '').length < 8) errs.password = 'Password must be at least 8 characters.';
      if (data.password !== data.confirm_password) errs.confirm_password = 'Passwords do not match.';
      if (!data.accept_privacy) errs.accept_privacy = 'Please accept the Terms of Service and read the Privacy Notice to continue.';
      if (Object.keys(errs).length) throw new ApiError('Please check the highlighted fields.', { status: 400, fields: errs });
      let res;
      try {
        res = await post('/auth/signup', { ...data, invite_token: query.invite || undefined });
      } catch (err) {
        // An email that already has an account gets the log-in and reset guidance at its field. The Log in link under the form stays.
        if (err.code === 'EMAIL_TAKEN') err.fields = { ...err.fields, email: 'This email is already registered. Log in or reset your password instead.' };
        // A message that sits at a field is said once, there. The form's banner only points at the highlighted fields.
        if (Object.keys(err.fields || {}).length) err.summary ||= 'Please check the highlighted fields.';
        throw err;
      }
      state.user = res.user;
      await refreshUser();
      if (res.devVerificationLink) {
        try { sessionStorage.setItem('bh-dev-verify', res.devVerificationLink); } catch { /* ignore */ }
      }
      if (res.emailFailed) {
        try { sessionStorage.setItem('bh-email-failed', '1'); } catch { /* ignore */ }
      }
      afterLogin();
    },
  });
  form.querySelector('.form-actions .btn').classList.add('btn--block');
  const google = await googleButton('Sign up with Google', query.invite);
  el.append(splitPage(authCard(
    invite ? `Join ${invite.organization_name}` : 'Create your account',
    invite ? `You were invited as ${{ cleaner: 'a cleaner', manager: 'a property manager', staff: 'staff' }[invite.role] || 'staff'}. Create your login to get started.` : 'Free to start. Set up your first property in a few minutes.',
    form,
    google, google && h('p', { class: 'small muted', style: { marginTop: '8px', textAlign: 'center' } },
      'By continuing with Google you agree to the ', h('a', { href: '#/terms', target: '_blank' }, 'Terms of Service'), ' and accept the ', h('a', { href: '#/privacy', target: '_blank' }, 'Privacy Notice'), '.'),
    h('div', { class: 'auth-card__foot' }, 'Already have an account? ', h('a', { href: '#/login' }, 'Log in')))));
}

// ---------------------------------------------------------------- password recovery
export async function forgotView(el) {
  const result = h('div');
  const form = makeForm({
    submitText: 'Send reset link',
    fields: [field({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' })],
    onSubmit: async (data) => {
      const res = await post('/auth/forgot-password', data);
      result.replaceChildren(h('div', { class: 'alert alert--ok' }, res.message), devLink(res.devResetLink, 'Reset password'));
    },
  });
  el.append(splitPage(authCard('Reset your password', "Enter your account email and we'll send a link to choose a new password.",
    result, form, h('div', { class: 'auth-card__foot' }, h('a', { href: '#/login' }, '‹ Back to log in')))));
}

export async function resetView(el, { query }) {
  if (!query.token) { navigate('#/forgot', { replace: true }); return; }
  const form = makeForm({
    submitText: 'Save new password',
    fields: [
      field({ name: 'password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters.' }),
      field({ name: 'confirm', label: 'Confirm new password', type: 'password', required: true, autocomplete: 'new-password' }),
    ],
    onSubmit: async (data) => {
      if (data.password !== data.confirm) throw new ApiError('Please check the highlighted fields.', { status: 400, fields: { confirm: 'Passwords do not match.' } });
      await post('/auth/reset-password', { token: query.token, password: data.password });
      state.user = null;
      navigate('#/login?reset=1', { replace: true });
    },
  });
  el.append(publicPage(authCard('Choose a new password', 'For your security, you will be logged out of other devices.', form)));
}

// ---------------------------------------------------------------- email verification
// Taglish for the two verification screens. The language chosen on the landing page carries here (initGuestLang reads it).
extendTranslations({
  'Verifying your email…': 'Vine-verify ang email mo…',
  "Couldn't verify": 'Hindi ma-verify',
  'This verification link is missing or incomplete. Log in to request a new one.': 'Kulang o sira ang verification link na ito. Mag-log in para humingi ng bagong link.',
  'Request a new link': 'Humingi ng bagong link',
  'Email verified.': 'Verified na ang email mo.',
  'Email verified': 'Verified na ang email mo',
  'You can now log in.': 'Puwede ka nang mag-log in.',
  'Log in': 'Mag-log in',
  'Check your email': 'Tingnan ang email mo',
  'We sent a verification link to {email}. Open it on this device to continue setting up BalayHub.': 'Nagpadala kami ng verification link sa {email}. Buksan ito sa device na ito para magpatuloy sa pag-set up ng BalayHub.',
  "Your account was created, but we couldn't send the verification email. The BalayHub administrator needs to check the server's email settings. Try “Resend” once that's fixed.": 'Nagawa na ang account mo, pero hindi namin naipadala ang verification email. Kailangang i-check ng BalayHub administrator ang email settings ng server. Subukan ang “Ipadala ulit” kapag naayos na.',
  'Verify my email': 'I-verify ang email ko',
  'Resend verification email': 'Ipadala ulit ang verification email',
  'A new verification email is on its way.': 'Papunta na ang bagong verification email.',
  "I've verified — continue": 'Na-verify ko na — tuloy',
  'Not verified yet. Open the link we sent to {email}, then press this again.': 'Hindi pa verified. Buksan ang link na ipinadala namin sa {email}, saka pindutin ulit ito.',
  'Use a different account': 'Gumamit ng ibang account',
  "Couldn't check. Check your connection and try again.": 'Hindi ma-check. Tingnan ang connection mo at subukan ulit.',
  'Development mode — email is not configured, so here is the link: ': 'Development mode — hindi pa naka-set ang email, kaya narito ang link: ',
  'This verification link is invalid or has expired. Log in to request a new one.': 'Hindi valid o expired na ang verification link na ito. Mag-log in para humingi ng bagong link.',
  'Too many attempts. Please wait a few minutes and try again.': 'Sobrang dami na ng subok. Maghintay ng ilang minuto at subukan ulit.',
  "We couldn't send the email. The BalayHub administrator needs to check the email settings on the server (docs/EMAIL-SETUP.md).": 'Hindi namin naipadala ang email. Kailangang i-check ng BalayHub administrator ang email settings sa server (docs/EMAIL-SETUP.md).',
  "You're offline or the server can't be reached.": 'Offline ka o hindi maabot ang server.',
});

export async function verifyView(el, { query }) {
  initGuestLang();
  const card = authCard(t('Verifying your email…'), null);
  el.append(publicPage(card));
  const fail = (message) => card.replaceChildren(h('h1', null, t("Couldn't verify")), h('div', { class: 'alert alert--error' }, message),
    h('p', { class: 'auth-card__foot' }, h('a', { href: state.user ? '#/verify-pending' : '#/login' }, t('Request a new link'))));
  // A link with no token can't be checked. Say so, rather than sending an empty token and showing the server's generic message.
  if (!query.token) { fail(t('This verification link is missing or incomplete. Log in to request a new one.')); return; }
  try {
    await post('/auth/verify-email', { token: query.token || '' });
    try { sessionStorage.removeItem('bh-dev-verify'); } catch { /* ignore */ }
    await refreshUser();
    toast(t('Email verified.'));
    if (state.user) afterLogin();
    else card.replaceChildren(h('h1', null, t('Email verified')), h('p', { class: 'lead' }, t('You can now log in.')), h('a', { class: 'btn btn--primary btn--block', href: '#/login' }, t('Log in')));
  } catch (err) {
    fail(tServer(err.message));
  }
}

export async function verifyPendingView(el) {
  initGuestLang();
  if (state.user.email_verified || !state.requireEmailVerification) { afterLogin(); return; }
  const email = state.user.email;
  let stored = null;
  try { stored = sessionStorage.getItem('bh-dev-verify'); } catch { /* ignore */ }
  let emailFailed = false;
  try { emailFailed = sessionStorage.getItem('bh-email-failed') === '1'; sessionStorage.removeItem('bh-email-failed'); } catch { /* ignore */ }
  const msg = h('div', null, devLink(stored, t('Verify my email')),
    emailFailed && h('div', { class: 'alert alert--error' }, t("Your account was created, but we couldn't send the verification email. The BalayHub administrator needs to check the server's email settings. Try “Resend” once that's fixed.")));
  const resend = h('button', {
    class: 'btn btn--secondary btn--block',
    onclick: async () => {
      resend.disabled = true;
      try {
        const r = await post('/auth/resend-verification');
        if (r.alreadyVerified) { await refreshUser(); afterLogin(); return; }
        // A new email replaces the old one, so the "not verified yet" note from an earlier press goes too.
        status.replaceChildren();
        msg.replaceChildren(h('div', { class: 'alert alert--ok' }, t('A new verification email is on its way.')), devLink(r.devVerificationLink, t('Verify my email')));
      } catch (err) { msg.replaceChildren(h('div', { class: 'alert alert--error' }, tServer(err.message))); }
      resend.disabled = false;
    },
  }, t('Resend verification email'));
  // Stays in the page (role="status", so a screen reader hears it) while the email is not verified yet.
  const status = h('div', { role: 'status' });
  el.append(publicPage(authCard(t('Check your email'),
    t('We sent a verification link to {email}. Open it on this device to continue setting up BalayHub.', { email }),
    msg,
    h('div', { class: 'form' }, resend,
      h('div', null,
        h('button', { class: 'btn btn--ghost btn--block', onclick: async () => {
          // Offline, the check cannot run: say so here and keep the page as it is.
          try { await refreshUser(); } catch {
            status.replaceChildren(h('div', { class: 'alert alert--error', style: { marginTop: '8px' } }, t("Couldn't check. Check your connection and try again.")));
            return;
          }
          if (!state.user || state.user.email_verified || !state.requireEmailVerification) { afterLogin(); return; }
          status.replaceChildren(h('div', { class: 'alert alert--warn', style: { marginTop: '8px' } },
            t('Not verified yet. Open the link we sent to {email}, then press this again.', { email })));
        } }, t("I've verified — continue")),
        status),
      h('button', { class: 'link-btn', onclick: async () => { try { localStorage.removeItem('bh-setup'); } catch { /* ignore */ } await post('/auth/logout'); state.user = null; navigate('#/login', { replace: true }); } }, t('Use a different account'))))));
}

// ---------------------------------------------------------------- workspace setup
const SETUP_MAX_AGE = 30 * 60 * 1000;

// The Get started answers belong to whoever typed them. They fit the signed-in person only when the saved email is
// theirs, or (Google sign-up, where the email isn't known yet) when they were saved in the last 30 minutes.
export function savedSetupFor(saved, email, now = Date.now()) {
  if (!saved || typeof saved !== 'object' || !saved.name) return null;
  if (saved.email) return String(saved.email).toLowerCase() === String(email || '').toLowerCase() ? saved : null;
  const at = Number(saved.saved_at);
  return Number.isFinite(at) && now - at >= 0 && now - at <= SETUP_MAX_AGE ? saved : null;
}

export async function setupView(el) {
  // A person who already has a workspace never sees this page, so answers saved on this device go too.
  if (state.user.organization_id) { try { localStorage.removeItem('bh-setup'); } catch { /* ignore */ } afterLogin(); return; }
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('bh-setup') || 'null'); } catch { /* ignore */ }
  // Answers that aren't this person's are deleted, never used. Fitting ones only fill the form; nothing is sent until they press the button.
  const saved = savedSetupFor(stored, state.user.email);
  if (stored && !saved) { try { localStorage.removeItem('bh-setup'); } catch { /* ignore */ } }
  const form = makeForm({
    submitText: 'Create workspace',
    fields: [
      field({ name: 'name', label: 'Business or workspace name', required: true, maxlength: 120, placeholder: 'e.g. Santos Staycations', hint: 'You can invite co-hosts, managers and staff later.', value: saved?.name }),
      field({ name: 'business_type', label: 'What do you rent out?', type: 'select', required: true, value: saved?.business_type || 'short_term', placeholderOption: false, options: [
        ['short_term', 'Short-term stays (Airbnb, staycations, per night)'],
        ['long_term', 'Long-term rentals (monthly tenants, leases)'],
        ['both', 'Both'],
      ], hint: 'Both adds monthly rentals: tenants, leases and rent. Most hosts choose Short-term. You can change this later in Settings.' }),
      // A saved number the server refused is corrected here; the number typed in this box is what gets sent.
      field({ name: 'phone', label: 'Mobile number', type: 'tel', inputmode: 'tel', maxlength: 20, placeholder: '0917 123 4567', autocomplete: 'tel', value: saved?.phone }),
    ],
    onSubmit: async (data) => {
      await post('/workspace', { ...data, units_band: saved?.units_band, phone: data.phone || undefined });
      try { localStorage.removeItem('bh-setup'); } catch { /* ignore */ }
      await refreshUser();
      navigate(data.business_type === 'long_term' ? '#/properties?new=1' : '#/launchpad', { replace: true });
    },
  });
  el.append(publicPage(authCard(`Welcome, ${state.user.full_name.split(' ')[0]}!`,
    "Let's set up your rental business. Next, you'll add your first listing or property.", form,
    h('div', { class: 'auth-card__foot' },
      h('button', { class: 'link-btn', type: 'button', onclick: async () => {
        try { localStorage.removeItem('bh-setup'); } catch { /* ignore */ }
        await post('/auth/logout'); state.user = null; navigate('#/login', { replace: true });
      } }, 'Use a different account')))));
}
