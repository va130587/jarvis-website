// Shared in-page layout check (run with page.evaluate): sideways scroll, off-screen, clipped text, overlapping neighbours.
'use strict';
function checkLayout() {
  const vw = document.documentElement.clientWidth, out = [];
  if (document.documentElement.scrollWidth > vw) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + vw);
  const visible = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length; };
  const label = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
  document.querySelectorAll('main *, .topbar *').forEach(el => {
    if (!visible(el) || el.closest('.table-wrap, .ring, svg, .template')) return;
    const b = el.getBoundingClientRect();
    if (b.width && b.right > vw + 1) out.push('off-screen: ' + label(el));
    const s = getComputedStyle(el);
    if (/^(P|H1|H2|H3|B|A|BUTTON|LABEL|SMALL|SPAN)$/.test(el.tagName) && s.display !== 'inline' && s.overflow === 'visible' && s.whiteSpace !== 'nowrap' && el.scrollWidth > el.clientWidth + 2) out.push('text overflows: ' + label(el));
  });
  // Neighbours inside flex / grid containers must not overlap.
  document.querySelectorAll('main *, .topbar').forEach(box => {
    if (!visible(box)) return;
    const d = getComputedStyle(box).display;
    if (!/flex|grid/.test(d) || box.closest('.ring, svg')) return;
    const kids = [...box.children].filter(k => visible(k) && !/absolute|fixed/.test(getComputedStyle(k).position));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), c = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (w > 2 && h > 2) out.push('overlap: ' + label(kids[i]) + ' / ' + label(kids[j]));
    }
  });
  return [...new Set(out)].slice(0, 8);
}
module.exports = { checkLayout };
