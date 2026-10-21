/* NOVA display options (Security and Settings): high contrast and larger text, next to the theme.
   Remembered in this browser like the theme (boot.js applies them before the first paint, so there is no flash). */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var $ = J.$, root = document.documentElement;
  var A = N.access = {};
  A.contrast = function () { return root.getAttribute('data-contrast') === 'high' ? 'high' : 'standard'; };
  A.text = function () { var t = root.getAttribute('data-text'); return t === '125' || t === '150' ? t : '100'; };
  A.setContrast = function (v) {
    if (v === 'high') root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    try { localStorage.setItem('nova.contrast', v === 'high' ? 'high' : 'standard'); } catch (e) { /* the choice just is not remembered */ }
  };
  A.setText = function (v) {
    if (v === '125' || v === '150') root.setAttribute('data-text', v); else root.removeAttribute('data-text');
    try { localStorage.setItem('nova.text', v === '125' || v === '150' ? v : '100'); } catch (e) { /* the choice just is not remembered */ }
  };
  function group(id, label, current, act, opts) {
    return '<div class="acc-group"><h3 class="label" id="' + id + '">' + label + '</h3><div class="theme-pick" role="radiogroup" aria-labelledby="' + id + '">' + opts.map(function (o) {
      return '<button type="button" class="theme-opt" role="radio" aria-checked="' + (current === o[0]) + '" data-act="' + act + '" data-id="' + o[0] + '"><b>' + o[1] + '</b><small>' + o[2] + '</small></button>';
    }).join('') + '</div></div>';
  }
  A.panel = function () {
    return '<article class="panel" id="accessPanel"><h2 class="label">Contrast and text size</h2>' +
      group('contrastLabel', 'Contrast', A.contrast(), 'novaContrast', [['standard', 'Standard', 'The normal look'], ['high', 'High contrast', 'Plain, strong text and borders, no background effects']]) +
      group('textLabel', 'Text size', A.text(), 'novaText', [['100', 'Standard', '100%'], ['125', 'Large', '125%'], ['150', 'Larger', '150%']]) +
      '<p class="small-text muted">Remembered in this browser, like the theme. They work together with Deep Space and Daylight.</p></article>';
  };
  function again(act, id) { J.render(false); var b = $('button[data-act="' + act + '"][data-id="' + id + '"]'); if (b) b.focus(); }
  Object.assign(J.actions, {
    novaContrast: function (v) { A.setContrast(v); again('novaContrast', v); J.toast(v === 'high' ? 'High contrast is on.' : 'Standard contrast.'); },
    novaText: function (v) { A.setText(v); again('novaText', v); J.toast(v === '100' ? 'Standard text size.' : 'Text size ' + v + '%.'); }
  });
})();
