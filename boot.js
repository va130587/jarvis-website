// The boot sequence plays once per visit, and never with reduce motion. (Kept in a file so the page can use a strict Content-Security-Policy.)
(function () {
  var skip = false;
  try { skip = sessionStorage.getItem('jarvis.booted') === '1'; } catch (e) {}
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) skip = true;
  if (skip) document.documentElement.classList.add('no-boot');
})();

// The chosen theme ("Daylight" or the default "Deep Space"), applied before the first paint so the page never flashes.
(function () {
  var t = null;
  try { t = localStorage.getItem('nova.theme'); } catch (e) {}
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();

// Display options (Security and Settings): high contrast and larger text, remembered like the theme and applied before the first paint.
(function () {
  try {
    if (localStorage.getItem('nova.contrast') === 'high') document.documentElement.setAttribute('data-contrast', 'high');
    var t = localStorage.getItem('nova.text'); if (t === '125' || t === '150') document.documentElement.setAttribute('data-text', t);
  } catch (e) {}
})();

// The app shell stays invisible until NOVA has drawn its own layout (or knows it runs without its server), so nothing jumps
// on first load. nova.js removes the class; this timer is only a safety net.
(function () {
  var html = document.documentElement;
  html.classList.add('nova-wait');
  setTimeout(function () { html.classList.remove('nova-wait'); }, 2500);
})();
