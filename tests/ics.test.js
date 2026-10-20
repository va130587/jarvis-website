// Unit tests for .ics import and export, and the add-to-calendar links (no browser needed).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ICS = require('../ics.js');

const FIX = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const WIDE = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2027, 11, 31) };
const dubai = ts => { const p = ICS.dubaiParts(ts); return p.date + ' ' + p.time; };
const byTitle = (r, t) => r.events.filter(e => e.title === t);

test('Google export: UTC, TZID, all-day, folded text, escapes, cancelled events', () => {
  const r = ICS.parse(FIX('google.ics'), WIDE);
  assert.equal(r.name, 'Roshan (Google)');
  const iv = byTitle(r, 'Interview with Careem')[0];
  assert.equal(dubai(iv.start), '2026-10-18 11:00', 'UTC 07:00 is 11:00 in Dubai');
  assert.equal(dubai(iv.end), '2026-10-18 12:00');
  assert.equal(iv.location, 'Careem HQ, Dubai Internet City');
  assert.match(iv.description, /^Bring CV, portfolio and Emirates ID\.\nAsk for Sara/);
  assert.match(iv.description, /so that the exporter folds it/, 'folded lines are joined');
  assert.equal(dubai(byTitle(r, 'Mentor call with Sara')[0].start), '2026-10-19 15:00');
  const fair = byTitle(r, 'Career fair at DWTC')[0];
  assert.equal(fair.allDay, true);
  assert.equal(fair.date, '2026-10-20');
  assert.equal(fair.endDate, '2026-10-21');
  assert.equal(byTitle(r, 'Cancelled meeting').length, 0, 'cancelled events are skipped');
});

test('Outlook export: Windows time-zone names, quoted TZID, LANGUAGE parameter', () => {
  const r = ICS.parse(FIX('outlook.ics'), WIDE);
  assert.equal(dubai(byTitle(r, 'HR screening call')[0].start), '2026-10-21 10:00', 'Arabian Standard Time = Dubai');
  // 9:00 in Los Angeles (PDT, UTC-7, in October) = 16:00 UTC = 20:00 in Dubai.
  assert.equal(dubai(byTitle(r, 'US team intro')[0].start), '2026-10-21 20:00');
});

test('Apple export: floating time, DURATION, multi-day all-day, crossing midnight, vendor TZID, emoji', () => {
  const r = ICS.parse(FIX('apple.ics'), WIDE);
  const gym = byTitle(r, 'Gym with Omar')[0];
  assert.equal(dubai(gym.start), '2026-10-22 18:30', 'floating times are treated as Dubai time');
  assert.equal(gym.end - gym.start, 90 * 60e3, 'DURATION PT1H30M');
  const trip = byTitle(r, 'Trip to Oman')[0];
  assert.deepEqual([trip.allDay, trip.date, trip.endDate], [true, '2026-10-23', '2026-10-26']);
  const late = byTitle(r, 'Late study session')[0];
  assert.equal(dubai(late.start), '2026-10-24 22:00');
  assert.equal(dubai(late.end), '2026-10-25 01:30', 'ends after midnight on the next day');
  const bday = r.events.find(e => /birthday/.test(e.title));
  assert.equal(bday.title, "Mum's birthday 🎂");
  assert.equal(bday.endDate, '2026-10-28', 'all-day with no DTEND lasts one day');
});

test('University timetable: weekly repeats, EXDATE, moved class, daylight saving, monthly', () => {
  const r = ICS.parse(FIX('university.ics'), { from: Date.UTC(2026, 9, 12), to: Date.UTC(2026, 9, 31) });
  const lec = byTitle(r, 'Data Structures lecture').map(e => dubai(e.start));
  assert.deepEqual(lec, ['2026-10-12 09:00', '2026-10-14 09:00', '2026-10-26 09:00', '2026-10-28 09:00'],
    'Mondays and Wednesdays; 19 Oct is cancelled (EXDATE); 21 Oct is replaced');
  assert.equal(dubai(byTitle(r, 'Data Structures lecture (moved)')[0].start), '2026-10-21 14:00');
  // London switches from BST (UTC+1) to GMT on 25 Oct 2026, so 09:00 London moves from 12:00 to 13:00 in Dubai.
  assert.deepEqual(byTitle(r, 'Call with London campus').map(e => dubai(e.start)),
    ['2026-10-23 12:00', '2026-10-24 12:00', '2026-10-25 13:00', '2026-10-26 13:00', '2026-10-27 13:00']);
  const all = ICS.parse(FIX('university.ics'), WIDE);
  assert.deepEqual(byTitle(all, 'Exam week starts').map(e => e.date), ['2026-12-14', '2027-01-14']);
  assert.equal(byTitle(all, 'Data Structures lecture').length, 27, 'whole semester: 29 Mon/Wed classes minus 1 holiday and 1 moved class');
});

test('Not a calendar file gives a clear error', () => {
  assert.throws(() => ICS.parse(FIX('not-a-calendar.ics')), /not a calendar/);
});

test('Export: valid structure, Dubai time zone, all-day, escaping, line folding, round trip', () => {
  const start = ICS.dubaiTs('2026-10-18', '11:00');
  const items = [
    { uid: 't1@jarvis', title: 'Interview: Graduate Analyst at Careem', start, end: start + 3600e3, description: 'Bring CV, ID; and portfolio\nRoom 4', location: 'Dubai' },
    { uid: 't2@jarvis', title: 'Application deadline: Data Intern', allDay: true, date: '2026-10-20', endDate: '2026-10-21' },
    { uid: 't3@jarvis', title: 'Late call ' + 'x'.repeat(120) + ' ✓', start: ICS.dubaiTs('2026-10-24', '23:30'), end: ICS.dubaiTs('2026-10-25', '00:30') }
  ];
  const out = ICS.build(items, { name: 'NOVA', now: Date.UTC(2026, 9, 15) });
  assert.match(out, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(out, /END:VCALENDAR\r\n$/);
  assert.match(out, /BEGIN:VTIMEZONE\r\nTZID:Asia\/Dubai/);
  assert.match(out, /DTSTART;TZID=Asia\/Dubai:20261018T110000/);
  assert.match(out, /DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021/);
  assert.match(out, /DESCRIPTION:Bring CV\\, ID\\; and portfolio\\nRoom 4/);
  out.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l, 'utf8') <= 75, 'every line is at most 75 octets: ' + l));
  const back = ICS.parse(out, WIDE);
  assert.equal(back.events.length, 3);
  assert.equal(dubai(back.events[0].start), '2026-10-18 11:00');
  assert.equal(back.events[0].description, 'Bring CV, ID; and portfolio\nRoom 4');
  assert.equal(back.events[1].allDay, true);
  assert.equal(back.events[2].title, items[2].title, 'long titles with non-ASCII survive folding');
  assert.equal(dubai(back.events[2].end), '2026-10-25 00:30');
});

test('Add to Google Calendar and Outlook links', () => {
  const start = ICS.dubaiTs('2026-10-18', '11:00');
  const g = ICS.googleLink({ title: 'Interview with Careem', start, end: start + 3600e3, description: 'Bring CV' });
  assert.equal(g, 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Interview%20with%20Careem&dates=20261018T070000Z/20261018T080000Z&ctz=Asia%2FDubai&details=Bring%20CV');
  const gd = ICS.googleLink({ title: 'Deadline', allDay: true, date: '2026-10-20' });
  assert.match(gd, /dates=20261020\/20261021/);
  const o = ICS.outlookLink({ title: 'Interview', start, end: start + 3600e3 });
  assert.match(o, /^https:\/\/outlook\.live\.com\/calendar\/0\/deeplink\/compose\?/);
  assert.match(o, /startdt=2026-10-18T11%3A00%3A00%2B04%3A00/);
  assert.match(o, /rru=addevent/);
  assert.match(ICS.outlookLink({ title: 'x', allDay: true, date: '2026-10-20' }, 'office'), /^https:\/\/outlook\.office\.com\/.*startdt=2026-10-20&enddt=2026-10-21&allday=true/);
});
