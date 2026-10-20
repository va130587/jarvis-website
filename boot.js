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
