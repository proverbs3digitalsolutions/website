// Applies the saved colour theme before the page paints (no flash of the wrong theme).
// 'light' or 'dark' force a theme; 'system' (default) follows the device setting.
(function () {
  var t = 'system';
  try { t = localStorage.getItem('bh-theme') || 'system'; } catch (e) { /* private mode */ }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
}());
