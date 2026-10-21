import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recurringDates} from '../phase5b.js';

const html=readFileSync('index.html','utf8');
const js=readFileSync('phase5b.js','utf8');
const backend=readFileSync('backend.js','utf8');
const sql=readFileSync('supabase/migrations/20261021000400_phase5b_recurring_bookings.sql','utf8');
const pages=readFileSync('.github/workflows/pages.yml','utf8');
const audit=readFileSync('supabase/security_audit_phase5b.sql','utf8');

test('recurrence generator anchors monthly at original day of month',()=>{
  assert.deepEqual(recurringDates('2027-01-31','Monthly',4),
    ['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
  assert.deepEqual(recurringDates('2028-01-31','Monthly',3),
    ['2028-01-31','2028-02-29','2028-03-31']);
});
test('weekly and fortnightly dates are bounded and consistent',()=>{
  assert.deepEqual(recurringDates('2027-01-04','Weekly',3),
    ['2027-01-04','2027-01-11','2027-01-18']);
  assert.deepEqual(recurringDates('2027-01-04','Fortnightly',3),
    ['2027-01-04','2027-01-18','2027-02-01']);
  assert.deepEqual(recurringDates('2027-01-04','Daily',3),[]);
  assert.deepEqual(recurringDates('2027-02-30','Monthly',2),[]);
  assert.deepEqual(recurringDates('2027-01-04','Weekly',9),[]);
});
test('new elements are present and unique, no raw HTML injection',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['phase5b-recurring','phase5b-enable','phase5b-cadence','phase5b-count',
     'phase5b-preview','phase5b-customer-series','phase5b-helper-series',
     'phase5b-setup-note','phase5b-customer-series-list','phase5b-helper-series-list'])
    assert.ok(ids.includes(id),'Missing '+id);
  assert.doesNotMatch(js,/innerHTML/);
});
test('old booking query is unchanged before optional migration',()=>{
  assert.match(backend,/const BOOKING_COLUMNS = 'id,service,frequency,area,preferred_date,preferred_time,estimated_hours,details,status,created_at';/);
  assert.match(backend,/phase5b\.isRecurring\(\)/);
  assert.match(backend,/await phase5b\.refresh\(\)/);
  assert.match(backend,/phase5b\.reset\(\)/);
  assert.match(js,/if\(probeError\)/);
});
test('one atomic request creates 2–8 visits, not perpetual recurrence',()=>{
  assert.match(sql,/^begin;/m);
  assert.match(sql,/commit;\s*$/);
  assert.equal((sql.match(/\$phase5b\$/g)||[]).length,4,'Two function bodies need four matching delimiters');
  assert.match(sql,/p_occurrences not between 2 and 8/);
  assert.match(sql,/v_day>current_date\+90/);
  assert.match(sql,/for v_i in 0\.\.p_occurrences-1 loop/);
  assert.match(sql,/series_occurrence_no/);
  assert.match(sql,/request_key/);
  assert.match(sql,/unique\(customer_id, request_key\)/);
  assert.doesNotMatch(sql,/pg_cron|cron\.schedule|create extension pg_net/i);
});
test('RLS, restricted grants, and participant access enforce identity',()=>{
  assert.match(sql,/recurring_booking_series enable row level security/);
  assert.match(sql,/recurring_series_participants_read/);
  assert.match(sql,/customer_id = \(select auth\.uid\(\)\)/);
  assert.match(sql,/p\.owner_id=\(select auth\.uid\(\)\)/);
  assert.match(sql,/grant select on public\.recurring_booking_series to authenticated/);
  assert.doesNotMatch(sql,/grant (?:insert|update|delete) on public\.recurring_booking_series to authenticated/i);
  assert.match(sql,/where id=p_series_id and customer_id=v_customer and status='active'/);
  assert.match(sql,/b\.status in \('pending','accepted'\)/);
  assert.match(sql,/b\.slot_start_at>now\(\)/);
  assert.match(audit,/has_table_privilege/);
});
test('accepted conflict safety and blocked dates remain enforced',()=>{
  assert.match(sql,/public\.helper_unavailable_dates/);
  assert.match(sql,/tstzrange\(b\.slot_start_at,b\.slot_end_at,'\[\)'\)/);
  assert.match(sql,/v_start<=now\(\)/);
  assert.match(sql,/for v_i in 0\.\.p_occurrences-1 loop/);
  assert.doesNotMatch(sql,/\bdrop\s+table\b|\btruncate\b/i);
});
test('Pages ships both new assets',()=>{
  assert.match(html,/phase5b\.css/);
  assert.match(backend,/from '\.\/phase5b\.js'/);
  assert.match(pages,/phase5b\.css/);
  assert.match(pages,/phase5b\.js/);
  assert.doesNotMatch(html+js+backend,/service_role|sb_secret_/i);
});
