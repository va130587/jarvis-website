// Layout at 1440, 768 and 390 px: no sideways scrolling, nothing off-screen or clipped, no overlapping
// neighbours, no console errors. Calendar screens are checked with Google, Outlook and .ics data loaded.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const NOW = Date.parse('2026-10-15T08:00:00+04:00');
const SHOTS = path.join(__dirname, 'screenshots');
const at = (d, hm) => ({ dateTime: d + 'T' + hm + ':00+04:00' });
const SCREENS = ['today', 'tasks', 'calendar', 'calendar-month', 'notes', 'jobs', 'applications', 'growth', 'review', 'profile', 'settings', 'help'];

let browser, server;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.after(async () => { await browser.close(); if (server) server.close(); });

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

async function loaded(width) {
  const google = {
    calendars: [{ id: 'me@gmail.com', summary: 'Personal calendar with a long name', primary: true, accessRole: 'owner', backgroundColor: '#4285f4' }, { id: 'uni', summary: 'University', accessRole: 'reader', backgroundColor: '#33b679' }],
    events: {
      'me@gmail.com': [
        { id: 'e1', summary: 'Team sync with the graduate programme managers', start: at('2026-10-15', '10:00'), end: at('2026-10-15', '11:00') },
        { id: 'e2', summary: 'Interview with Careem', start: at('2026-10-16', '11:00'), end: at('2026-10-16', '12:00') },
        { id: 'e3', summary: 'Career fair at Dubai World Trade Centre', start: { date: '2026-10-17' }, end: { date: '2026-10-20' } },
        { id: 'e4', summary: 'Late study', start: at('2026-10-17', '22:00'), end: at('2026-10-18', '01:00') }
      ],
      uni: [1, 2, 3, 4, 5].map(i => ({ id: 'u' + i, summary: 'Lecture ' + i, start: at('2026-10-15', (8 + i) + ':00'.padStart(3, '0')), end: at('2026-10-15', (9 + i) + ':00') }))
    }
  };
  google.events.uni.forEach((e, i) => { e.start = at('2026-10-15', String(8 + i).padStart(2, '0') + ':30'); e.end = at('2026-10-15', String(9 + i).padStart(2, '0') + ':15'); });
  const graph = { calendars: [{ id: 'cal-main', name: 'Calendar', hexColor: '#0078d4', canEdit: true, isDefaultCalendar: true }],
    events: { 'cal-main': [{ id: 'm1', subject: 'HR screening call', start: { dateTime: '2026-10-16T06:00:00.0000000' }, end: { dateTime: '2026-10-16T06:30:00.0000000' }, isAllDay: false }] } };
  const app = await H.openApp(browser, { now: NOW, google, graph, width, height: width === 390 ? 844 : 900, hash: 'settings' });
  const { page } = app;
  await page.fill('#gClientId', '123456789012-abcdefghijk.apps.googleusercontent.com');
  await page.click('[data-act="calConnect"][data-id="google"]');
  await page.waitForFunction(() => J.data.cal.google.connected && J.data.cal.google.lastSync > 0);
  await page.check('input[data-calmode="google"][value="two-way"]');
  await page.waitForFunction(() => J.data.cal.google.mode === 'two-way' && window.__gis.requests.length === 2);
  await page.fill('#mClientId', '1a2b3c4d-1234-5678-9abc-1234567890ab');
  await page.click('[data-act="calConnect"][data-id="microsoft"]');
  await page.waitForFunction(() => J.data.cal.microsoft.connected && J.data.cal.microsoft.lastSync > 0);
  await page.setInputFiles('#icsFile', path.join(__dirname, 'fixtures', 'university.ics'));
  await page.waitForFunction(() => J.data.cal.ics.length === 1);
  return app;
}

for (const width of [1440, 768, 390]) {
  test('layout at ' + width + ' px', async () => {
    const { page, ctx, errors } = await loaded(width);
    const problems = [];
    for (const s of SCREENS) {
      const view = s === 'calendar-month' ? 'calendar' : s;
      await page.evaluate(v => { location.hash = v; }, view);
      await page.waitForTimeout(150);
      if (view === 'calendar') { await page.click('[data-act="seg"][data-id="' + (s === 'calendar-month' ? 'month' : 'week') + '"]'); }
      await page.waitForTimeout(700); // let entrance animations finish
      const r = await page.evaluate(checkLayout);
      r.forEach(x => problems.push(s + ': ' + x));
      await page.screenshot({ path: path.join(SHOTS, width + '-' + s + '.png'), fullPage: true });
    }
    // Dialogs used by the calendar
    await page.evaluate(() => { location.hash = 'calendar'; }); await page.waitForTimeout(300);
    await page.click('[data-act="seg"][data-id="week"]');
    await page.click('.ev.ext >> nth=0');
    await page.screenshot({ path: path.join(SHOTS, width + '-event-dialog.png') });
    const dlg = await page.evaluate(() => { const d = document.getElementById('formDialog').getBoundingClientRect(); return d.right <= innerWidth && d.left >= 0; });
    assert.ok(dlg, 'event dialog fits the screen');
    await page.keyboard.press('Escape');
    assert.deepEqual(problems, [], problems.join('\n'));
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
