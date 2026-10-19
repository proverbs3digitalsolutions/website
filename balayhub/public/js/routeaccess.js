// Which hash routes a signed-in user may open (the menu already hides the rest; this stops URL access).

const STAY_ONLY = ['/home', '/launchpad', '/inbox', '/inbox-settings', '/calendar', '/reservations', '/groups', '/daily-close', '/listings', '/guests', '/quotes', '/addons', '/owners', '/stay-reports', '/pnl', '/pricing', '/reviews', '/discount-codes', '/gatepass-settings', '/receipts', '/cleaner-pay', '/supplies', '/lost-found', '/housekeeping'];
const RENTAL_ONLY = ['/dashboard']; // /properties, /tenants and /rent are linked from stay screens too
const OWNER_ONLY = ['/launchpad', '/owners'];
const CLEANER_ONLY = ['/my-pay'];
const CLEANER_BLOCKED = ['/supplies']; // the API refuses cleaners the supplies list; they read job supplies on the task itself
const STAFF_BLOCKED = ['/launchpad', '/owners', '/inbox', '/inbox-settings', '/stay-reports', '/pnl', '/quotes', '/addons', '/daily-close', '/gatepass-settings', '/discount-codes', '/cleaner-pay', '/lost-found'];

const under = (path, list) => list.some((p) => path === p || path.startsWith(`${p}/`));

// While the owner has not confirmed a card (D-98) only the card page, Help and Account open; once confirmed the card page bounces home.
const CARD_DUE_OK = ['/confirm-card', '/help', '/account'];

// user: { role, business_type, is_platform_admin }; the workspace's modules are user.business_type.
export function routeAllowed(path, user) {
  if (!user) return true;
  if (user.plan?.card_check_due) return under(path, CARD_DUE_OK);
  if (path === '/confirm-card') return false;
  if (under(path, ['/admin'])) return Boolean(user.is_platform_admin);
  const type = user.business_type;
  // Cleaners keep /housekeeping (their home page) whatever the workspace type, so the redirect can't loop.
  if (type === 'long_term' && under(path, STAY_ONLY) && user.role !== 'cleaner') return false;
  if (type === 'short_term' && under(path, RENTAL_ONLY)) return false;
  if (user.role === 'staff' && under(path, STAFF_BLOCKED)) return false;
  if (user.role === 'manager' && under(path, OWNER_ONLY)) return false;
  if (user.role !== 'cleaner' && under(path, CLEANER_ONLY)) return false;
  if (user.role === 'cleaner' && under(path, CLEANER_BLOCKED)) return false;
  return true;
}
