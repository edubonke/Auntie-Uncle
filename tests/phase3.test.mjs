import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const backend = readFileSync('backend.js','utf8');
const css = readFileSync('dashboard.css','utf8');
const pages = readFileSync('.github/workflows/pages.yml','utf8');

test('dashboard IDs are unique and present for JS bindings',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'Duplicate HTML ids');
  const fromJs=[...backend.matchAll(/\$\(['"]#([-\w]+)['"]\)/g)].map(m=>m[1]);
  for(const id of fromJs)assert.ok(ids.includes(id),'Missing element: '+id);
});
test('role dashboards have tab semantics, controls and panels',()=>{
  for(const role of ['customer','helper','admin']){
    assert.match(html,new RegExp('id="tab-'+role+'"[^>]*role="tab"'));
    assert.match(html,new RegExp('id="dashboard-'+role+'"[^>]*role="tabpanel"'));
    assert.match(backend,new RegExp("switchDashboard"));
  }
  assert.match(backend,/am_i_marketplace_admin/);
  assert.match(backend,/tab.hidden=name==='admin'&&!adminEnabled/);
});
test('customer and helper actions use existing scoped RPCs',()=>{
  assert.match(backend,/cancel_my_booking/);
  assert.match(backend,/respond_to_booking/);
  assert.match(backend,/review_helper_application/);
  assert.match(backend,/from\('helper_profiles'\)\.update\(payload\)/);
  assert.ok(!backend.includes('innerHTML'),'User generated data should be rendered as text nodes');
});
test('new styles are published with the Pages artifact',()=>{
  assert.ok(html.includes('href="dashboard.css"'));
  assert.ok(pages.includes('dashboard.css'));
  assert.match(css,/@media \(max-width:560px\)/);
});
test('marketplace credentials are not added to public dashboards',()=>{
  assert.ok(!/service_role|SUPABASE_SECRET|postgresql:\/\/postgres:/.test(backend+css+html));
});
