/* Auntie & Uncle — Supabase-backed accounts, applications and booking requests.
   The publishable key is safe in the browser; all authorization is enforced by PostgreSQL RLS. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

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
  return error?.message === 'Invalid login credentials' ? 'Incorrect email or password.' :
    'The request could not be completed. Please try again or contact the platform administrator.';
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

async function refreshAccount() {
  if (refreshing) return;
  refreshing = true;
  try {
    const {data:{user:authUser}, error} = await supabase.auth.getUser();
    user = error ? null : authUser;
    authenticated = Boolean(user);
    $('#account-anon').hidden = authenticated;
    $('#account-signed-in').hidden = !authenticated;
    if (!authenticated) {
      $('#account-user').textContent = '';
      $('#customer-bookings').replaceChildren();
      $('#provider-bookings').replaceChildren();
      $('#admin-panel').hidden = true;
      $('#helper-application-state').textContent = 'Sign in to submit an application.';
      return;
    }
    $('#account-user').textContent = user.email || 'Signed-in customer';
    if (!operational) return;
    const [{data:myHelpers,error:helperErr}, {data:myBookings,error:bookingErr}, {data:isAdmin,error:adminErr}] = await Promise.all([
      supabase.from('helper_profiles').select('id,display_name,status,service').eq('owner_id',user.id).limit(1),
      supabase.from('bookings').select('id,service,area,preferred_date,preferred_time,estimated_hours,details,status,created_at').eq('customer_id',user.id).order('created_at',{ascending:false}).limit(25),
      supabase.rpc('am_i_marketplace_admin')
    ]);
    if (helperErr || bookingErr || adminErr) { status('Connected, but account records could not be loaded. Check migration and RLS policies.',true); return; }
    const mine = myHelpers?.[0];
    $('#helper-application-state').textContent = mine ? `Your ${mine.service} application: ${mine.status}.` : 'You have not submitted an application.';
    renderBookingList('#customer-bookings',myBookings ?? [],'customer');
    if (mine) {
      const {data:providerBookings,error:providerErr} = await supabase.from('bookings')
        .select('id,service,area,preferred_date,preferred_time,estimated_hours,details,status,created_at')
        .eq('helper_id',mine.id).order('created_at',{ascending:false}).limit(25);
      if (!providerErr) renderBookingList('#provider-bookings',providerBookings ?? [],'helper');
    } else {$('#provider-bookings').replaceChildren(elt('p','Apply to become a helper to manage requests.'));}
    $('#admin-panel').hidden = !isAdmin;
    if (isAdmin) await loadAdminApplications();
  } catch (error) {console.warn('[Auntie & Uncle] Account refresh failed:',error?.message || 'Unknown error');status('The account could not be refreshed. Retry when your connection is available.',true);}
  finally {refreshing = false;}
}
function renderBookingList(selector, rows, view) {
  const root = $(selector);
  root.replaceChildren();
  if (!rows.length) {root.append(elt('p','No requests yet.','form-small')); return;}
  rows.forEach(row => {
    const card = elt('article','','booking-item');
    const title = elt('strong',`${row.service} · ${row.area}`);
    const date = elt('p',`${row.preferred_date} ${row.preferred_time?.slice(0,5) || ''} · ${row.status}`,'booking-meta');
    const desc = elt('p',row.details,'booking-description');
    card.append(title,date,desc);
    if (view === 'helper' && row.status === 'pending') {
      ['accepted','declined'].forEach(decision => {
        const button=elt('button',decision==='accepted'?'Accept request':'Decline request','button button-outline button-small');
        button.type='button';
        button.addEventListener('click',async () => {
          button.disabled=true;
          const {error}=await supabase.rpc('respond_to_booking',{p_booking_id:row.id,p_decision:decision});
          if(error) {alert(safeError(error));button.disabled=false;return;}
          await refreshAccount();
        });
        card.append(button);
      });
    } else if(view==='customer' && ['pending','accepted'].includes(row.status)) {
      const button=elt('button','Cancel request','button button-outline button-small');
      button.type='button';
      button.addEventListener('click', async()=>{
        if (!confirm('Cancel this request?')) return;
        button.disabled=true;
        const {error}=await supabase.rpc('cancel_my_booking',{p_booking_id:row.id});
        if(error){alert(safeError(error));button.disabled=false;return;}
        await refreshAccount();
      });
      card.append(button);
    }
    root.append(card);
  });
}
async function loadAdminApplications() {
  const root=$('#pending-applications');root.replaceChildren();
  const {data,error}=await supabase.from('helper_profiles')
    .select('id,display_name,service,area,hourly_rate,bio,status').eq('status','pending').order('created_at',{ascending:true}).limit(50);
  if(error){root.append(elt('p','Unable to load pending applications.'));return;}
  if(!data.length){root.append(elt('p','No pending helper applications.'));return;}
  for(const item of data){
    const card=elt('article','','booking-item');
    card.append(elt('strong',`${item.display_name} · ${item.service} · ${item.area} · R${item.hourly_rate}/hr`),elt('p',item.bio,'booking-description'));
    for(const decision of ['approved','rejected']){
      const btn=elt('button',decision==='approved'?'Approve listing':'Reject listing','button button-outline button-small');
      btn.type='button';btn.addEventListener('click',async()=>{
        if(!confirm(`${decision==='approved'?'Approve':'Reject'} ${item.display_name}?`))return;
        btn.disabled=true;
        const {error}=await supabase.rpc('review_helper_application',{p_helper_id:item.id,p_new_status:decision});
        if(error){alert(safeError(error));btn.disabled=false;return;}
        await loadDirectory();await loadAdminApplications();
      });card.append(btn);
    }root.append(card);
  }
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
  } catch(error){inlineError('#account-error',safeError(error));}
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
