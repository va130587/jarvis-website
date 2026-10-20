// Dubai time for schedules. The UAE has no daylight saving, so Dubai is always UTC+4; the times below are exact, not approximations.
'use strict';
const OFFSET = 4 * 3600e3, DAY = 86400e3;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SETS = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] };      // UAE working week: Monday to Friday

function parts(ms) { const d = new Date(ms + OFFSET); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay(), iso: d.toISOString().slice(0, 10) }; }
function dayList(days) { if (SETS[days]) return SETS[days]; const l = String(days || '').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6); return l.length ? l : SETS.daily; }
function validDays(days) { return !!SETS[days] || /^[0-6](,[0-6]){0,6}$/.test(String(days)); }
// The first moment strictly after `after` that is hh:mm in Dubai on an allowed weekday.
function nextRun(after, hour, minute, days) {
  const allowed = dayList(days), p = parts(after);
  let t = Date.UTC(p.y, p.mo - 1, p.d, hour, minute) - OFFSET;
  for (let i = 0; i < 9; i++, t += DAY) if (t > after && allowed.includes(parts(t).wd)) return t;
  throw new Error('no next run');
}
const hhmm = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
function describe(days) { return days === 'daily' ? 'every day' : days === 'weekdays' ? 'Monday to Friday' : days === 'weekends' ? 'Saturday and Sunday' : dayList(days).map(d => DAY_NAMES[d].slice(0, 3)).join(', '); }
const label = ms => ms ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)) : null;
module.exports = { parts, nextRun, dayList, validDays, describe, hhmm, label, DAY_NAMES, OFFSET, DAY };
