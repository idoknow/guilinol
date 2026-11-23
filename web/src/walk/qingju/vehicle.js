/**
 * vehicle.js — the "system record" for this bike.  When the page is opened for
 * the first time the vehicle is activated and the system issues a licence plate
 * (format: G + 4 characters), which is then persisted locally and printed on
 * the real plate on the rear mudguard.
 */
const KEY = 'qinggui.vehicle.v2';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function issuePlate() {
  let s = 'G';
  for (let i = 0; i < 4; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

export function getVehicle() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { v = null; }
  if (!v || typeof v.plate !== 'string' || !/^G[A-Z0-9]{4}$/.test(v.plate)) {
    const plate = issuePlate();
    v = {
      plate,
      region: '桂林',
      id: 'QG' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      activatedAt: new Date().toISOString(),
      fresh: true,
    };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }
  return v;
}

export function vehiclePlate() {
  return getVehicle().plate;
}
