"""Mocked Supabase adapter smoke test; does not access production data."""
from pathlib import Path
import asyncio
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
MOCK = r'''
let currentUser=null;
const helper={id:'11111111-1111-4111-8111-111111111111',owner_id:'22222222-2222-4222-8222-222222222222',display_name:'Test Example',service:'Cleaning',area:'Randburg',hourly_rate:150,years_experience:2,bio:'A mock profile for integration tests only.',status:'approved',created_at:'2026-10-20T00:00:00Z'};
const bookings=[];
const data=(table,filters)=>({data: table==='helper_profiles' ? (filters.owner_id?[]:(filters.status==='approved'?[helper]:[])) : table==='bookings'?bookings.filter(b=>b.customer_id===filters.customer_id):[],error:null});
function builder(table){let f={};return{
 select(){return this;},eq(k,v){f[k]=v;return this;},order(){return this;},limit(){return this;},then(resolve,reject){return Promise.resolve(data(table,f)).then(resolve,reject);},
 maybeSingle(){return Promise.resolve({data:null,error:null});},
 insert(payload){const b={...payload,id:'33333333-3333-4333-8333-333333333333',status:'pending',customer_id:currentUser.id};bookings.push(b);return{select(){return {single(){return Promise.resolve({data:b,error:null});}}}}},
 update(){return {eq(){return Promise.resolve({error:null})}}}
 }}
export function createClient(){return{
 from:builder,
 rpc(name){return Promise.resolve({data:false,error:null});},
 auth:{ getUser(){return Promise.resolve({data:{user:currentUser},error:null});},
 onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
 signInWithPassword(){currentUser={id:'44444444-4444-4444-8444-444444444444',email:'test@example.com'};return Promise.resolve({data:{user:currentUser},error:null});},
 signUp(){currentUser={id:'44444444-4444-4444-8444-444444444444',email:'test@example.com'};return Promise.resolve({data:{session:true},error:null});},
 signOut(){currentUser=null;return Promise.resolve({error:null});}
 }};}
'''

async def run():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
        page=await browser.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_default_timeout(4500)
        page.on('console',lambda m: print('CONSOLE',m.type,m.text[:150],flush=True) if m.type in ('error','warning') else None)
        html=(ROOT/'index.html').read_text()
        css=(ROOT/'styles.css').read_text()
        app=(ROOT/'app.js').read_text()
        backend=(ROOT/'backend.js').read_text()
        backend=backend.replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';",'').replace("import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';", "const SUPABASE_URL='https://example.supabase.co'; const SUPABASE_PUBLISHABLE_KEY='sb_publishable_mock';")
        html=html.replace('<link rel="stylesheet" href="styles.css">',f'<style>{css}</style>')
        html=html.replace('<script src="app.js" defer></script>','').replace('<script type="module" src="backend.js"></script>','')
        html=html.replace('</body>',f'<script>{app}</script><script type="module">{MOCK}\n{backend}</script></body>')
        print('SET CONTENT',flush=True)
        await page.set_content(html,wait_until='load')
        print('STATUS',await page.locator('#live-status').inner_text(),flush=True)
        print('ERRORS',errors,flush=True)
        await page.wait_for_function("document.querySelector('#result-count').textContent.includes('1 approved helper')",timeout=4500)
        print('FOUND HELPER',flush=True)
        assert await page.locator('.helper-card').count()==1
        assert 'APPROVED LISTING' in await page.locator('.helper-card').inner_text()
        await page.locator('#account-email').fill('test@example.com')
        await page.locator('#account-password').fill('example-password-123')
        await page.locator('#account-submit').click()
        await page.wait_for_function("document.querySelector('#account-signed-in').hidden === false")
        await page.locator('.profile-button').click()
        await page.get_by_role('button',name='Request this helper').click()
        await page.locator('#date').fill('2026-11-02')
        await page.locator('#details').fill('Please perform a deep house clean on the scheduled date.')
        await page.locator('#enquiry-form .form-submit').click()
        await page.wait_for_function("document.querySelector('#request-result').hidden === false")
        assert 'Request sent to helper' in await page.locator('#request-result').inner_text()
        print('BOOKINGS STATUS',await page.locator('#customer-bookings').inner_text(), 'ACCOUNT',await page.locator('#account-user').inner_text(), 'STATUS',await page.locator('#live-status').inner_text(), flush=True)
        await page.wait_for_function("document.querySelector('#customer-bookings').textContent.includes('Cleaning')")
        assert not errors, errors
        print('PASS: mock Supabase loads approved helper, signs in, stores booking request, refreshes account dashboard')
        await browser.close()

if __name__=='__main__':asyncio.run(run())
