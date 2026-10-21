import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync('index.html','utf8');
const backend=readFileSync('backend.js','utf8');
const js=readFileSync('phase4.js','utf8');
const sql=readFileSync('supabase/migrations/20261021000200_phase4_calendar_and_notifications.sql','utf8');
const pages=readFileSync('.github/workflows/pages.yml','utf8');
const styles=readFileSync('phase4.css','utf8');
test('calendar and updates have accessible controls and unique IDs',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'IDs must be unique');
  for(const id of ['phase4-calendar','phase4-day-grid','phase4-month-label','phase4-updates',
    'phase4-updates-list','phase4-read-updates','phase4-refresh-updates','phase4-setup-note',
    'phase4-booking-availability','phase4-calendar-feedback'])assert.ok(ids.includes(id),id+' missing');
  assert.match(html,/aria-pressed|aria-live/);
});
test('new code only uses existing session and approved helper, and can fall back',()=>{
  assert.match(backend,/createPhase4/);
  assert.match(backend,/phase4\.refresh\(\)/);
  assert.match(backend,/phase4\.reset\(\)/);
  assert.match(backend,/phase4\.canRequest/);
  assert.match(js,/helper_unavailable_dates/);
  assert.match(js,/account_notifications/);
  assert.match(js,/if\(availability\.error\|\|notification\.error\)/);
  assert.ok(!js.includes('innerHTML'),'Never render user data through raw HTML');
});
test('availability SQL is scoped to helper ownership and approved public profiles',()=>{
  assert.match(sql,/helper_unavailable_dates enable row level security/);
  assert.match(sql,/availability_owner_add/);
  assert.match(sql,/availability_owner_remove/);
  assert.match(sql,/p\.owner_id=\(select auth\.uid\(\)\)/);
  assert.match(sql,/p\.status='approved'/);
  assert.match(sql,/booking_day_availability_guard/);
  assert.match(sql,/unavailable_date=new\.preferred_date/);
});
test('notifications are private and are not client-insertable',()=>{
  assert.match(sql,/account_notifications enable row level security/);
  assert.match(sql,/notifications_read_own/);
  assert.match(sql,/notifications_mark_own/);
  assert.match(sql,/grant update \(read_at\)/);
  assert.match(sql,/revoke all on public\.account_notifications from public, anon, authenticated/);
  assert.doesNotMatch(sql,/grant insert[^;]*account_notifications to authenticated/i);
  assert.match(sql,/notify_booking_change/);
  assert.match(sql,/notify_helper_review/);
});
test('all three PL/pgSQL functions have balanced dollar quote delimiters',()=>{
  assert.equal((sql.match(/\$\$/g)||[]).length,6,'Each of the three function bodies must open and close with $$');
  assert.match(sql,/return null;\s*end;\s*\$\$;\s*revoke all on function public\.notify_helper_review/);
  assert.match(sql,/after insert or update on public\.helper_profiles/);
});
test('deployment contains both new assets',()=>{
  assert.match(html,/phase4\.css/);
  assert.match(backend,/import \{ createPhase4 \} from '\.\/phase4\.js'/);
  assert.match(pages,/phase4\.css/);
  assert.match(pages,/phase4\.js/);
  assert.match(styles,/@media\(max-width:640px\)/);
});
test('no destructive table operations or privileged credentials',()=>{
  assert.doesNotMatch(sql,/\b(?:drop\s+table|truncate|delete\s+from\s+public\.bookings)\b/i);
  assert.doesNotMatch(html+js+backend,/service_role|postgresql:\/\/postgres:|sb_secret_/i);
});
