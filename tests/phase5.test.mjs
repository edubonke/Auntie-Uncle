import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync('index.html','utf8');
const app=readFileSync('app.js','utf8');
const backend=readFileSync('backend.js','utf8');
const js=readFileSync('phase5.js','utf8');
const sql=readFileSync('supabase/migrations/20261021000300_phase5_schedule_and_reschedule.sql','utf8');
const pages=readFileSync('.github/workflows/pages.yml','utf8');

test('phase 5 HTML controls exist, unique and are safely escaped',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'Duplicate HTML IDs');
  for(const id of ['phase5-time-slots','phase5-slot-options','phase5-slot-message','phase5-setup-note'])assert.ok(ids.includes(id),id);
  assert.ok(!js.includes('innerHTML'),'User-supplied content cannot be inserted as unescaped HTML');
});
test('phase 5 integration preserves older booking behaviour without migration',()=>{
  assert.match(backend,/createPhase5/);
  assert.match(backend,/phase5\.checkBeforeBooking\(selected\)/);
  assert.match(backend,/phase5\.enhanceBookingCard\(card,row,view\)/);
  assert.match(backend,/await phase5\.refresh\(\)/);
  assert.match(backend,/phase5\.reset\(\)/);
  assert.match(js,/if\(!ready\)return \{ok:true\}/);
  assert.match(js,/if\(probeError\)/);
  assert.match(app,/auntie:helper-selected/);
});
test('SQL PL/pgSQL function bodies are balanced and migration is transactional',()=>{
  assert.equal((sql.match(/\$phase5\$/g)||[]).length,8,'Four PL/pgSQL or SQL function bodies must be balanced');
  assert.match(sql,/^begin;/m);
  assert.match(sql,/commit;\s*$/);
  assert.doesNotMatch(sql,/\bdrop\s+table\b/i);
  assert.doesNotMatch(sql,/\btruncate\b/i);
});
test('conflicts are guaranteed by database accepted-slot exclusion, not UI only',()=>{
  assert.match(sql,/create extension if not exists btree_gist/);
  assert.match(sql,/booking_accepted_no_overlap/);
  assert.match(sql,/exclude using gist/);
  assert.match(sql,/where \(status='accepted' and slot_start_at is not null/);
  assert.match(sql,/booking_slot_guard_trigger/);
  assert.match(sql,/reject blocked|Helper unavailable on selected date/);
  assert.match(js,/get_helper_busy_slots/);
  assert.match(js,/dayAvailability/);
});
test('reschedule requests require helper approval and cannot directly update booking',()=>{
  assert.match(sql,/booking_reschedule_read_participants/);
  assert.match(sql,/grant select on public\.booking_reschedule_requests to authenticated/);
  assert.doesNotMatch(sql,/grant (?:insert|update|delete)[^;]*on public\.booking_reschedule_requests to authenticated/i);
  assert.match(sql,/request_booking_reschedule/);
  assert.match(sql,/decide_booking_reschedule/);
  assert.match(sql,/p\.owner_id=\(select auth\.uid\(\)\)/);
  assert.match(sql,/when p_accept then 'accepted' else 'declined'/);
  assert.match(js,/refreshAccount/);
});
test('busy slot API protects booking/customer details',()=>{
  assert.match(sql,/get_helper_busy_slots/);
  assert.match(sql,/returns table\(busy_start time, busy_end time\)/);
  assert.match(sql,/and p\.status='approved'/);
  assert.match(sql,/p_date<=current_date\+90/);
  assert.doesNotMatch(sql,/grant select[^;]*on public\.bookings to anon/i);
});
test('Phase 5 assets are shipped to GitHub Pages',()=>{
  assert.match(html,/phase5\.css/);
  assert.match(backend,/from '\.\/phase5\.js'/);
  assert.match(pages,/phase5\.css/);
  assert.match(pages,/phase5\.js/);
});
