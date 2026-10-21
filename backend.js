/* Auntie & Uncle — Supabase-backed accounts, applications and booking requests.
   The publishable key is safe in the browser; all authorization is enforced by PostgreSQL RLS. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { createPhase4 } from './phase4.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
});
const $ = selector => document.querySelector(selector);
const elt = (tag, text, className = '') => {
  const node = document.createElement(tag);
  node.textContent = String(text ?? '');
  if (className) node.className = className;
  return node;
};
const formValue = id => document.getElementById(id)?.value?.trim() ?? '';
let user = null;
let authenticated = false;
let operational = false;
let refreshing = false;
const status = (message, error = false) => {
  const node = $('#live-status');
  node.textContent = message;
  node.dataset.error = String(error);
};
const inlineError = (selector, message) => {
  const node = $(selector);
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
};
function safeError(error) {
  console.warn('[Auntie & Uncle] Backend request failed:', error?.code || 'unknown');
  return error?.message === 'Helper unavailable on selected date' ? 'This helper has blocked the selected date. Please choose another day.' :
    error?.message === 'Invalid login credentials' ? 'Incorrect email or password.' :
    'The request could not be completed. Please try again or contact the platform administrator.';
}

// Translate only known authentication errors; do not expose raw server messages
// or reveal whether a particular email address is already registered.
function safeAuthError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === 'email_address_not_authorized' || message.includes('email address not authorized'))
    return 'This email address cannot receive a confirmation email through the current Supabase email provider. The administrator must configure custom SMTP before public registration.';
  if (code === 'over_email_send_rate_limit' || message.includes('email rate limit exceeded'))
    return 'Supabase has reached its email sending limit. Wait before retrying, or ask the administrator to configure custom SMTP.';
  if (code === 'over_request_rate_limit' || error?.status === 429)
    return 'Too many registration attempts. Please wait a few minutes before trying again.';
  if (code === 'email_provider_disabled' || code === 'signup_disabled' || message.includes('signups not allowed'))
    return 'Email registrations are disabled in Supabase Authentication settings. Please contact the administrator.';
  if (code === 'email_not_confirmed')
    return 'Please verify your email before signing in. Check your inbox and spam folder.';
  if (code === 'weak_password')
    return 'The password does not meet the security requirements. Please choose a stronger password.';
  if (code === 'invalid_credentials' || message.includes('invalid login credentials'))
    return 'Incorrect email or password, or the account is not yet ready to sign in.';
  if (code === 'email_address_invalid')
    return 'Please enter a valid email address.';
  if (code === 'user_already_exists' || code === 'email_exists')
    return 'If you already have an account, choose Sign in instead of Create an account.';
  if (error?.name === 'AuthRetryableFetchError' || message.includes('failed to fetch'))
    return 'Unable to reach Supabase Authentication. Check your internet connection and try again.';
  const safeCode = /^[a-z][a-z0-9_]{2,63}$/.test(code) ? ' (code: ' + code + ')' : '';
  return 'Authentication could not be completed' + safeCode + '. Please contact the platform administrator.';
}
async function loadDirectory() {
  const {data, error} = await supabase.from('helper_profiles')
    .select('id,display_name,service,area,hourly_rate,years_experience,bio,status')
    .eq('status','approved').order('created_at',{ascending:false});
  if (error) { operational = false; status('Demo mode: the database tables are not available yet. Apply the SQL migration to activate the marketplace.',true); return; }
  operational = true;
  const helpers = (data ?? []).map((p, i) => ({
    id:p.id, name:p.display_name, initials:p.display_name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase(),
    service:p.service, area:p.area, regions:[p.area], rate:Number(p.hourly_rate), years:p.years_experience,
    icon:({'Cleaning':'🧹','Childcare':'🧸','Cooking':'🍲','Gardening':'🌿','Handyman':'🛠️','Moving & rearranging':'📦'})[p.service] || '✳',
    tone:['mint','lilac','sage','peach'][i%4], headline:'Independent household service provider',
    bio:p.bio, services:[p.service], schedule:'Contact for availability', isLive:true
  }));
  window.AuntieDirectory?.useLive(helpers);
  status(`Marketplace connected · ${helpers.length} approved helper ${helpers.length===1?'listing':'listings'}. Bookings require sign-in and provider acceptance.`);
  $('#browse-description').textContent = 'Explore approved marketplace listings. Provider availability and any background checks must be confirmed before a booking.';
  $('#directory-disclaimer').textContent = 'Live listings are administrator-approved for display, but this alone does not guarantee screening, background checks or qualifications. Confirm details before booking.';
  $('#helper-sort-label').textContent = 'Sort helpers';
  $('#market-empty h3').textContent = 'No matching approved helpers';
  $('#market-empty p').textContent = 'Try a different area or service. If the directory is empty, no helper listings have been approved yet.';
  $('#market-summary-rate').textContent = 'Indicative ZAR rates set by independent helpers; final prices are agreed separately.';
  $('#join-note').textContent = 'Your application is stored securely when signed in. Profiles are not listed until reviewed and approved. Do not enter ID numbers or sensitive details.';
  $('#enquiry-note').textContent = 'A signed-in customer can send a request to a listed helper. Booking is not confirmed until the helper accepts. No payment is taken.';
  $('#faq-real').textContent = 'Approved helper listings appear in the live directory. Administrator approval does not constitute a guarantee of identity checks, screening, credentials, availability or work quality.';
  $('#faq-booking').textContent = 'No. A signed-in customer sends a request to an approved helper; the helper must accept or decline. Price, scope and safety arrangements must be agreed directly.';
  $('#faq-verified').textContent = 'Applications are reviewed before public display. Background-check or childcare screening procedures are not yet implemented and must be established before a public launch.';
  $('#footer-disclaimer').textContent = 'Marketplace beta: only administrator-approved profiles are public. Bookings are requests, not confirmed appointments. No payments, ID verification or background screening are provided.';
}

// Phase 3 uses only the existing RLS-protected tables and narrow RPCs.
// Dashboard statistics cover the 100 most recent records, not an all-time total.
let dashboardUserId = null;
let activeDashboard = 'customer';
let adminEnabled = false;
let currentHelper = null;
let customerRows = [], providerRows = [], adminHelperRows = [], adminBookingRows = [];
const BOOKING_COLUMNS = 'id,service,frequency,area,preferred_date,preferred_time,estimated_hours,details,status,created_at';
const statusLabel = value => ({pending:'Pending',approved:'Approved',accepted:'Accepted',declined:'Declined',cancelled:'Cancelled',rejected:'Rejected',suspended:'Suspended'})[value] || 'Unknown';
const briefDate = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}) : 'Date not provided';
const money = value => 'R' + Number(value).toLocaleString('en-ZA',{minimumFractionDigits:0,maximumFractionDigits:2});
const notice = message => {$('#dashboard-feedback').textContent=message;};
const phase4 = createPhase4({supabase,currentUser:()=>user,currentHelper:()=>currentHelper,
  selectedHelper:()=>window.AuntieDirectory?.selected(),feedback:notice});
function summaryCard(label, number, note) {
  const item=elt('div','','stat-card');
  item.append(elt('span',label,'stat-label'),elt('strong',String(number),'stat-number'),elt('span',note,'stat-note'));
  return item;
}
function dashboardStats() {
  const stats=$('#dashboard-stats');stats.replaceChildren();
  let metrics;
  if(activeDashboard==='admin') {
    metrics=[
      ['Applications',adminHelperRows.filter(p=>p.status==='pending').length,'Waiting for review'],
      ['Published',adminHelperRows.filter(p=>p.status==='approved').length,'Approved listings'],
      ['Bookings',adminBookingRows.length,'Most recent records'],
      ['Accepted',adminBookingRows.filter(b=>b.status==='accepted').length,'Recent accepted requests']
    ];
  } else {
    const rows=activeDashboard==='helper'?providerRows:customerRows;
    metrics=[
      ['Requests',rows.length,'Most recent records'],
      ['Pending',rows.filter(b=>b.status==='pending').length,'Awaiting a response'],
      ['Accepted',rows.filter(b=>b.status==='accepted').length,'Agreed requests'],
      ['Closed',rows.filter(b=>['declined','cancelled'].includes(b.status)).length,'Declined or cancelled']
    ];
  }
  for(const metric of metrics)stats.append(summaryCard(...metric));
}
function switchDashboard(next, focus=false) {
  if(!['customer','helper','admin'].includes(next) || (next==='admin'&&!adminEnabled))return;
  activeDashboard=next;
  for(const name of ['customer','helper','admin']){
    const tab=$('#tab-'+name), panel=$('#dashboard-'+name), selected=name===next;
    tab.hidden=name==='admin'&&!adminEnabled;
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex=selected?0:-1;
    panel.hidden=!selected;
  }
  dashboardStats();
  if(focus)$('#tab-'+next).focus();
}
for(const tab of document.querySelectorAll('[data-dashboard]')){
  tab.addEventListener('click',()=>switchDashboard(tab.dataset.dashboard));
  tab.addEventListener('keydown',event=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
    event.preventDefault();
    const options=['customer','helper',...(adminEnabled?['admin']:[])];
    const index=options.indexOf(tab.dataset.dashboard);
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:
      (index+(event.key==='ArrowRight'?1:-1)+options.length)%options.length;
    switchDashboard(options[next],true);
  });
}
function actionButton(label, handler, style='outline'){
  const btn=elt('button',label,'button button-'+style+' button-small');btn.type='button';
  btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{await handler();}catch(error){notice('Action failed. '+safeError(error));}
    finally{btn.disabled=false;}
  });
  return btn;
}
function renderBookingList(selector, rows, view) {
  const root=$(selector), filter=$(view==='customer'?'#customer-status-filter':'#helper-status-filter').value;
  const filtered=filter==='all'?rows:rows.filter(r=>r.status===filter);
  root.replaceChildren();
  if(!filtered.length){root.append(elt('p',rows.length?'No requests match this filter.':'No requests yet.','empty-state'));return;}
  for(const row of filtered){
    const card=elt('article','','booking-item booking-card');
    const heading=elt('div','','booking-topline');
    heading.append(elt('strong',row.service+' · '+row.area),elt('span',statusLabel(row.status),'status-chip status-'+row.status));
    const when=briefDate(row.preferred_date)+(row.preferred_time?' at '+row.preferred_time.slice(0,5):'');
    const parts=[when,row.frequency||'One-time help',row.estimated_hours?Number(row.estimated_hours)+' hour(s)':'Duration to confirm'];
    card.append(heading,elt('p',parts.join(' · '),'booking-meta'),elt('p',row.details,'booking-description'));
    if(view==='helper'&&row.status==='pending'){
      const actions=elt('div','','booking-actions');
      for(const decision of ['accepted','declined']){
        actions.append(actionButton(decision==='accepted'?'Accept request':'Decline request',async()=>{
          if(!confirm(decision==='accepted'?'Accept this booking request?':'Decline this booking request?'))return;
          const {error}=await supabase.rpc('respond_to_booking',{p_booking_id:row.id,p_decision:decision});
          if(error)throw error;
          notice('Request '+decision+'.');await refreshAccount();
        },decision==='accepted'?'dark':'outline'));
      }
      card.append(actions);
    }else if(view==='customer'&&['pending','accepted'].includes(row.status)){
      card.append(actionButton('Cancel request',async()=>{
        if(!confirm('Cancel this request?'))return;
        const {error}=await supabase.rpc('cancel_my_booking',{p_booking_id:row.id});
        if(error)throw error;
        notice('Booking request cancelled.');await refreshAccount();
      }));
    }
    root.append(card);
  }
}
$('#customer-status-filter').addEventListener('change',()=>renderBookingList('#customer-bookings',customerRows,'customer'));
$('#helper-status-filter').addEventListener('change',()=>renderBookingList('#provider-bookings',providerRows,'helper'));

function fillHelperForm(helper){
  const fields={'edit-helper-name':helper.display_name,'edit-helper-service':helper.service,'edit-helper-area':helper.area,
    'edit-helper-rate':helper.hourly_rate,'edit-helper-years':helper.years_experience,'edit-helper-bio':helper.bio};
  for(const [id,value] of Object.entries(fields))document.getElementById(id).value=value??'';
}
$('#toggle-profile-edit').addEventListener('click',()=>{
  const form=$('#helper-profile-form'),expanded=form.hidden;
  form.hidden=!expanded;$('#toggle-profile-edit').setAttribute('aria-expanded',String(expanded));
  if(expanded)$('#edit-helper-name').focus();
});
$('#helper-profile-form').addEventListener('submit',async e=>{
  e.preventDefault();inlineError('#edit-helper-error','');
  if(!currentHelper)return;
  const form=e.currentTarget;if(!form.reportValidity())return;
  const bio=formValue('edit-helper-bio');
  if(bio.length<10){inlineError('#edit-helper-error','Please describe your service in at least 10 characters.');return;}
  const payload={display_name:formValue('edit-helper-name'),service:formValue('edit-helper-service'),
    area:formValue('edit-helper-area'),hourly_rate:Number(formValue('edit-helper-rate')),
    years_experience:Number(formValue('edit-helper-years')),bio};
  if(!confirm('Save changes? If this listing is approved, changes to public details will return it to Pending review.'))return;
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    const {error}=await supabase.from('helper_profiles').update(payload).eq('id',currentHelper.id);
    if(error)throw error;
    notice('Profile saved. Changes to an approved listing require another administrator review.');
    form.hidden=true;$('#toggle-profile-edit').setAttribute('aria-expanded','false');
    await loadDirectory();await refreshAccount();
  }catch(error){inlineError('#edit-helper-error',safeError(error));}
  finally{button.disabled=false;}
});
function helperProfilePanel(profile){
  currentHelper=profile??null;
  $('#helper-profile-panel').hidden=!profile;
  $('#helper-apply-link').hidden=Boolean(profile);
  $('#helper-application-state').textContent=profile?
    'Your '+profile.service+' application: '+statusLabel(profile.status)+'.'+
      (profile.status==='approved'?' Your listing is visible to customers.':' It is not currently in the public directory.'):
    'You have not submitted a helper application.';
  if(profile)fillHelperForm(profile);
}
function adminBookingOverview(){
  const root=$('#admin-bookings');root.replaceChildren();
  if(!adminBookingRows.length){root.append(elt('p','No booking activity yet.','empty-state'));return;}
  for(const booking of adminBookingRows.slice(0,15)){
    const card=elt('article','','admin-compact-row');
    card.append(elt('strong',booking.service+' · '+booking.area),
      elt('span',briefDate(booking.preferred_date)+' · '+statusLabel(booking.status),'booking-meta'));
    root.append(card);
  }
  if(adminBookingRows.length>15)root.append(elt('p','Showing the 15 most recent requests.','form-small'));
}
function adminProfileList(){
  const root=$('#admin-helper-list');root.replaceChildren();
  const listed=adminHelperRows.filter(p=>['approved','suspended','rejected'].includes(p.status));
  if(!listed.length){root.append(elt('p','No reviewed listings yet.','empty-state'));return;}
  for(const helper of listed.slice(0,40)){
    const card=elt('article','','admin-compact-row');
    const title=elt('div','','booking-topline');
    title.append(elt('strong',helper.display_name+' · '+helper.service+' · '+helper.area),
      elt('span',statusLabel(helper.status),'status-chip status-'+helper.status));
    card.append(title,elt('p',money(helper.hourly_rate)+'/hr (indicative)','booking-meta'));
    if(helper.status==='approved')card.append(actionButton('Suspend listing',async()=>{
      if(!confirm('Suspend this listing? It will disappear from public search.'))return;
      await reviewHelper(helper.id,'suspended');}));
    if(helper.status==='suspended')card.append(actionButton('Return to review queue',async()=>{
      if(!confirm('Return this listing to Pending review?'))return;
      await reviewHelper(helper.id,'pending');}));
    root.append(card);
  }
}
async function reviewHelper(helperId,nextStatus){
  const {error}=await supabase.rpc('review_helper_application',{p_helper_id:helperId,p_new_status:nextStatus});
  if(error)throw error;
  notice('Helper listing updated to '+statusLabel(nextStatus)+'.');
  await loadDirectory();await refreshAccount();
}
function renderPendingApplications(){
  const root=$('#pending-applications');root.replaceChildren();
  const pending=adminHelperRows.filter(p=>p.status==='pending');
  if(!pending.length){root.append(elt('p','No pending helper applications.','empty-state'));return;}
  for(const applicant of pending.slice(0,50)){
    const card=elt('article','','booking-item booking-card');
    card.append(elt('strong',applicant.display_name+' · '+applicant.service+' · '+applicant.area),
      elt('p',money(applicant.hourly_rate)+'/hr · '+Number(applicant.years_experience)+' years reported experience','booking-meta'),
      elt('p',applicant.bio,'booking-description'));
    const actions=elt('div','','booking-actions');
    for(const decision of ['approved','rejected']){
      actions.append(actionButton(decision==='approved'?'Approve listing':'Reject listing',async()=>{
        if(!confirm((decision==='approved'?'Approve':'Reject')+' '+applicant.display_name+
          '? Only approve after completing your verification and safeguarding checks.'))return;
        await reviewHelper(applicant.id,decision);
      },decision==='approved'?'dark':'outline'));
    }
    card.append(actions);root.append(card);
  }
}
async function loadAdminOverview(){
  const [{data:profiles,error:helperError},{data:bookings,error:bookingError}]=await Promise.all([
    supabase.from('helper_profiles').select('id,display_name,service,area,hourly_rate,years_experience,bio,status,created_at').order('created_at',{ascending:false}).limit(100),
    supabase.from('bookings').select('id,service,area,preferred_date,status,created_at').order('created_at',{ascending:false}).limit(100)
  ]);
  if(helperError||bookingError){notice('Some administrator records could not be loaded. Please retry.');return;}
  adminHelperRows=profiles??[];adminBookingRows=bookings??[];
  renderPendingApplications();adminProfileList();adminBookingOverview();dashboardStats();
}
async function refreshAccount() {
  if(refreshing)return;
  refreshing=true;
  try{
    const {data:{user:authUser},error}=await supabase.auth.getUser();
    user=error?null:authUser;authenticated=Boolean(user);
    $('#account-anon').hidden=authenticated;$('#account-signed-in').hidden=!authenticated;
    $('#account .account-layout').classList.toggle('dashboard-open',authenticated);
    if(!authenticated){
      dashboardUserId=null;adminEnabled=false;currentHelper=null;
      customerRows=[];providerRows=[];adminHelperRows=[];adminBookingRows=[];
      $('#account-user').textContent='';
      $('#customer-bookings').replaceChildren();$('#provider-bookings').replaceChildren();
      switchDashboard('customer');
      phase4.reset();
      return;
    }
    $('#account-user').textContent=user.email||'Signed-in member';
    if(!operational){notice('Marketplace database is not available yet.');return;}
    const newSession=dashboardUserId!==user.id;dashboardUserId=user.id;
    const [{data:mine,error:helperErr},{data:bookings,error:bookingErr},{data:isAdmin,error:adminErr}]=await Promise.all([
      supabase.from('helper_profiles').select('id,display_name,service,area,hourly_rate,years_experience,bio,status').eq('owner_id',user.id).limit(1),
      supabase.from('bookings').select(BOOKING_COLUMNS).eq('customer_id',user.id).order('created_at',{ascending:false}).limit(100),
      supabase.rpc('am_i_marketplace_admin')
    ]);
    if(helperErr||bookingErr||adminErr){notice('Could not load your account data. Check the database permissions and try again.');return;}
    const profile=mine?.[0]??null;customerRows=bookings??[];helperProfilePanel(profile);
    adminEnabled=Boolean(isAdmin);
    if(profile){
      const {data:received,error:incomingErr}=await supabase.from('bookings').select(BOOKING_COLUMNS)
        .eq('helper_id',profile.id).order('created_at',{ascending:false}).limit(100);
      if(incomingErr){notice('Could not load incoming bookings.');providerRows=[];}
      else providerRows=received??[];
    }else providerRows=[];
    renderBookingList('#customer-bookings',customerRows,'customer');
    renderBookingList('#provider-bookings',providerRows,'helper');
    if(adminEnabled)await loadAdminOverview();
    else{adminHelperRows=[];adminBookingRows=[];}
    if(newSession)activeDashboard=adminEnabled?'admin':profile?'helper':'customer';
    switchDashboard(activeDashboard==='admin'&&!adminEnabled?'customer':activeDashboard);
    await phase4.refresh();
  }catch(error){console.warn('[Auntie & Uncle] Dashboard refresh failed:',error?.code||'unexpected');notice('Unable to refresh your account. Try again.');}
  finally{refreshing=false;}
}
$('#account-form').addEventListener('submit', async event => {
  event.preventDefault();
  inlineError('#account-error','');
  const button=$('#account-submit');button.disabled=true;
  try {
    const email=formValue('account-email'),password=formValue('account-password'),display=formValue('account-display');
    if ($('#account-mode').value==='signup') {
      if(password.length<10){inlineError('#account-error','Use a password of at least 10 characters.');return;}
      if(display.length<2){inlineError('#account-error','Provide a display name.');return;}
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:display}}});
      if(error) throw error;
      $('#account-success').textContent = data.session ? 'Account created and signed in.' : 'If this address can register, a confirmation email will be sent. Check your inbox.';
    } else {
      const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;
      $('#account-success').textContent='Signed in successfully.';
    }
    $('#account-password').value='';
    await refreshAccount();
  } catch(error){inlineError('#account-error',safeAuthError(error));}
  finally{button.disabled=false;}
});
$('#account-mode').addEventListener('change',()=>{
  const signup=$('#account-mode').value==='signup';
  $('#account-display-wrap').hidden=!signup;
  $('#account-display').required=signup;
  $('#account-submit').textContent=signup?'Create account':'Sign in';
  inlineError('#account-error','');$('#account-success').textContent='';
});
$('#sign-out').addEventListener('click',async()=>{
  const {error}=await supabase.auth.signOut();
  if(error){alert(safeError(error));return;}
  $('#account-success').textContent='Signed out.';
  await refreshAccount();
});
$('#refresh-account').addEventListener('click',()=>refreshAccount());

window.addEventListener('auntie:join',async e=>{
  inlineError('#join-error','');
  if(!operational){inlineError('#join-error','The booking database is not ready.');return;}
  if(!authenticated){inlineError('#join-error','Sign in or create an account before submitting an application.');$('#account').scrollIntoView({behavior:'smooth'});return;}
  if(formValue('join-bio').length < 10){inlineError('#join-error','Please describe your service in at least 10 characters before submitting your application.');$('#join-bio').focus();return;}
  const button=$('#helper-join-form .form-submit');button.disabled=true;
  try {
    const payload={display_name:formValue('join-name'),service:formValue('join-service'),area:formValue('join-area'),
      hourly_rate:Number(formValue('join-rate')),bio:formValue('join-bio')};
    const {data:existing,error:lookErr}=await supabase.from('helper_profiles').select('id,status').eq('owner_id',user.id).maybeSingle();
    if(lookErr)throw lookErr;
    const response=existing ? await supabase.from('helper_profiles').update(payload).eq('id',existing.id) :
      await supabase.from('helper_profiles').insert(payload);
    if(response.error)throw response.error;
    const root=$('#join-preview-content');root.replaceChildren(elt('h3','Application submitted for review'),
      elt('p','Your profile will not appear publicly unless approved. This is not a verification of identity or qualifications.'));
    $('#helper-join-form').hidden=true;$('#join-preview').hidden=false;
    await refreshAccount();
  } catch(error){inlineError('#join-error',safeError(error));}
  finally{button.disabled=false;}
});
window.addEventListener('auntie:book',async e=>{
  inlineError('#form-error','');
  if(!operational){inlineError('#form-error','The booking database is not ready.');return;}
  if(!authenticated){inlineError('#form-error','Sign in first to submit a real booking request.');$('#account').scrollIntoView({behavior:'smooth'});return;}
  const selected=window.AuntieDirectory?.selected();
  if(!selected?.isLive){inlineError('#form-error','Select an approved helper from the live directory before submitting.');$('#browse').scrollIntoView({behavior:'smooth'});return;}
  if(!formValue('date')){inlineError('#form-error','Choose a preferred date before submitting.');return;}
  if (formValue('details').length<10){inlineError('#form-error','Describe the work in at least 10 characters.');return;}
  const btn=$('#enquiry-form .form-submit');btn.disabled=true;
  try {
    if(phase4.ready && await phase4.canRequest(selected.id,formValue('date')) === false){
      inlineError('#form-error','This helper is unavailable on the selected date. Choose another date.');
      return;
    }
    const payload={helper_id:selected.id,service:formValue('service'),frequency:formValue('frequency'),
      area:formValue('area'),preferred_date:formValue('date'),preferred_time:formValue('booking-time')||null,
      estimated_hours:formValue('booking-hours')?Number(formValue('booking-hours')):null,details:formValue('details')};
    const {data,error}=await supabase.from('bookings').insert(payload).select('id,status').single();
    if(error)throw error;
    $('#enquiry-form').hidden=true;$('#request-result').hidden=false;
    $('#request-result h3').textContent='Request sent to helper';
    $('#request-result > p').textContent='Your request is pending. It is not a confirmed booking and no payment was taken.';
    $('#request-preview').textContent=`Request reference: ${data.id}\nStatus: ${data.status}\nService: ${payload.service}\nArea: ${payload.area}\nDate: ${payload.preferred_date}`;
    $('#copy-request').hidden=true;$('#whatsapp-request').hidden=true;
    $('#copy-status').textContent='You can view this request under My account.';
    await refreshAccount();
  }catch(error){inlineError('#form-error',safeError(error));}
  finally{btn.disabled=false;}
});

// Live mode becomes active only after the migration and read policy are available.
window.AuntieUncleLive={get operational(){return operational;}};
supabase.auth.onAuthStateChange(()=>{
  // Avoid synchronous Supabase API calls inside auth event callbacks.
  Promise.resolve().then(()=>refreshAccount());
});
await loadDirectory();
await refreshAccount();
