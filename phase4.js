/* Phase 4: whole-day helper unavailability + private in-app updates.
   Optional until the additive Supabase SQL migration is applied.
   Public and private access rules are enforced by Supabase RLS. */
export function createPhase4({supabase,currentUser,currentHelper,selectedHelper,feedback}) {
  const $ = selector => document.querySelector(selector);
  const make = (tag,text,className='') => {
    const el=document.createElement(tag);
    el.textContent=String(text??'');
    if(className)el.className=className;
    return el;
  };
  const pad = n => String(n).padStart(2,'0');
  const isoDay = (y,m,d) => y+'-'+pad(m+1)+'-'+pad(d);
  const today = () => {
    const d=new Date();
    return isoDay(d.getFullYear(),d.getMonth(),d.getDate());
  };
  const originalMonth = new Date();
  let month = new Date(originalMonth.getFullYear(),originalMonth.getMonth(),1);
  let ready=false, loadedFor=null, blocks=new Map(), notifications=[];
  let currentHelperId=null;
  let loading=false;
  let checking=0;
  const cal=$('#phase4-calendar'),updates=$('#phase4-updates'),setup=$('#phase4-setup-note');
  const unavailableHint=$('#phase4-booking-availability');
  function fallback(message=''){
    cal.hidden=true;updates.hidden=true;setup.hidden=!currentUser();
    if(message)setup.textContent=message;
    unavailableHint.hidden=true;
  }
  function reset(){
    ready=false;loadedFor=null;currentHelperId=null;blocks=new Map();notifications=[];
    month=new Date(new Date().getFullYear(),new Date().getMonth(),1);
    setup.textContent='Availability and in-app updates are waiting for the Phase 4 database upgrade. Existing bookings still work.';
    fallback();
  }
  function renderUpdates(){
    const root=$('#phase4-updates-list');root.replaceChildren();
    const unread=notifications.filter(n=>!n.read_at).length;
    $('#phase4-unread-label').textContent=unread?'('+unread+' unread in recent activity)':'(all recent updates read)';
    $('#phase4-read-updates').disabled=unread===0;
    if(!notifications.length){root.append(make('p','No account updates yet.','empty-state'));return;}
    for(const item of notifications){
      const card=make('article','','phase4-update'+(item.read_at?'':' phase4-unread'));
      const heading=make('div','','booking-topline');
      heading.append(make('strong',item.title),make('span',item.read_at?'Read':'New','status-chip'));
      const when=new Date(item.created_at);
      card.append(heading,make('p',item.body,'form-small'),
        make('time',Number.isNaN(when.getTime())?'':when.toLocaleString('en-ZA',{dateStyle:'medium',timeStyle:'short'}),'phase4-timestamp'));
      root.append(card);
    }
  }
  async function loadUpdates(){
    const u=currentUser();if(!u)return;
    const {data,error}=await supabase.from('account_notifications')
      .select('id,kind,title,body,created_at,read_at')
      .eq('user_id',u.id).order('created_at',{ascending:false}).limit(30);
    if(error)throw error;
    notifications=data??[];updates.hidden=false;renderUpdates();
  }
  async function loadCalendar(){
    const helper=currentHelper();
    if(!helper){cal.hidden=true;currentHelperId=null;blocks=new Map();return;}
    currentHelperId=helper.id;cal.hidden=false;
    const y=month.getFullYear(),m=month.getMonth();
    const first=isoDay(y,m,1),next=isoDay(y,m+1,1); // month+1 accepted by isoDay? see below
    const nextMonth=new Date(y,m+1,1);
    const nextStart=isoDay(nextMonth.getFullYear(),nextMonth.getMonth(),1);
    const {data,error}=await supabase.from('helper_unavailable_dates')
      .select('id,unavailable_date').eq('helper_id',helper.id)
      .gte('unavailable_date',first).lt('unavailable_date',nextStart).order('unavailable_date');
    if(error)throw error;
    blocks=new Map((data??[]).map(x=>[x.unavailable_date,x.id]));
    renderCalendar();
  }
  function renderCalendar(){
    const year=month.getFullYear(),monthNum=month.getMonth();
    $('#phase4-month-label').textContent=month.toLocaleDateString('en-ZA',{month:'long',year:'numeric'});
    const previousAllowed=monthNum>new Date().getMonth()||year>new Date().getFullYear();
    $('#phase4-prev-month').disabled=!previousAllowed;
    const grid=$('#phase4-day-grid');grid.replaceChildren();
    const firstDay=new Date(year,monthNum,1);
    const offset=(firstDay.getDay()+6)%7;
    for(let i=0;i<offset;i++)grid.append(make('span','','phase4-blank'));
    const daysInMonth=new Date(year,monthNum+1,0).getDate();
    for(let d=1;d<=daysInMonth;d++){
      const date=isoDay(year,monthNum,d),isBlocked=blocks.has(date),isPast=date<today();
      const day=make('button',String(d),isBlocked?'phase4-date phase4-blocked':'phase4-date');
      day.type='button';day.disabled=isPast;
      day.setAttribute('aria-label',new Date(year,monthNum,d).toLocaleDateString('en-ZA',{dateStyle:'full'})+
        (isBlocked?', unavailable':', available for new requests'));
      day.setAttribute('aria-pressed',String(isBlocked));
      day.title=isBlocked?'Click to unblock this day':'Click to block this day';
      day.addEventListener('click',async()=>{
        const u=currentUser(),helper=currentHelper();
        if(!ready||!u||!helper||helper.id!==currentHelperId)return;
        const action=isBlocked?'unblock':'block';
        if(!confirm('Do you want to '+action+' '+date+'? Existing bookings will NOT be cancelled.'))return;
        day.disabled=true;
        try{
          if(isBlocked){
            const {error}=await supabase.from('helper_unavailable_dates').delete()
              .eq('id',blocks.get(date)).eq('helper_id',helper.id);
            if(error)throw error;
          }else{
            const {error}=await supabase.from('helper_unavailable_dates')
              .insert({helper_id:helper.id,unavailable_date:date});
            if(error)throw error;
          }
          $('#phase4-calendar-feedback').textContent='Availability saved for '+date+'.';
          await loadCalendar();
          await checkBookingDate();
        }catch(error){
          $('#phase4-calendar-feedback').textContent='Could not update this day. Refresh and try again.';
          console.warn('[Auntie & Uncle] Calendar error:',error?.code||'unknown');
          day.disabled=false;
        }
      });
      grid.append(day);
    }
  }
  async function checkBookingDate(){
    const helper=selectedHelper(),date=$('#date').value;
    const current=++checking;
    if(!ready||!helper?.isLive||!date){unavailableHint.hidden=true;return;}
    const value=await canRequest(helper.id,date);
    if(current!==checking)return;
    unavailableHint.hidden=false;
    unavailableHint.textContent=value===false?
      'Unavailable: this helper has blocked the selected date. Please choose another.':
      value===null?'Availability could not be checked right now. Submission will be checked by the database.':
      'No whole-day block is recorded for this date. The helper must still accept your request.';
    unavailableHint.dataset.blocked=String(value===false);
  }
  async function canRequest(helperId,date){
    if(!ready||!helperId||!date)return null;
    const {data,error}=await supabase.from('helper_unavailable_dates')
      .select('id').eq('helper_id',helperId).eq('unavailable_date',date).limit(1);
    if(error){console.warn('[Auntie & Uncle] Availability lookup:',error.code||'unknown');return null;}
    return (data??[]).length===0;
  }
  async function refresh(){
    const u=currentUser();
    if(!u){reset();return;}
    if(loading)return;
    loading=true;
    try{
      if(loadedFor!==u.id||!ready){
        const [availability,notification]=await Promise.all([
          supabase.from('helper_unavailable_dates').select('id').limit(1),
          supabase.from('account_notifications').select('id').limit(1)
        ]);
        if(availability.error||notification.error){
          ready=false;fallback('Phase 4 features are not active yet. Apply the migration in Supabase SQL Editor; your existing account and booking features remain available.');
          return;
        }
        ready=true;loadedFor=u.id;setup.hidden=true;
      }
      await Promise.all([loadUpdates(),loadCalendar()]);
      await checkBookingDate();
    }catch(error){
      console.warn('[Auntie & Uncle] Phase 4 refresh:',error?.code||'unknown');
      fallback('Phase 4 data could not be loaded. Your existing account features remain available. Retry Refresh data.');
    }finally{loading=false;}
  }
  $('#phase4-next-month').addEventListener('click',async()=>{
    month=new Date(month.getFullYear(),month.getMonth()+1,1);
    try{await loadCalendar();}catch{feedback('Could not load the next month.');}
  });
  $('#phase4-prev-month').addEventListener('click',async()=>{
    const prev=new Date(month.getFullYear(),month.getMonth()-1,1);
    const t=new Date();const minimum=new Date(t.getFullYear(),t.getMonth(),1);
    if(prev<minimum)return;
    month=prev;
    try{await loadCalendar();}catch{feedback('Could not load the previous month.');}
  });
  $('#phase4-refresh-updates').addEventListener('click',async()=>{
    try{await loadUpdates();}catch{feedback('Unable to refresh account updates.');}
  });
  $('#phase4-read-updates').addEventListener('click',async()=>{
    const u=currentUser();if(!u||!ready)return;
    const button=$('#phase4-read-updates');button.disabled=true;
    try{
      const {error}=await supabase.from('account_notifications')
        .update({read_at:new Date().toISOString()}).eq('user_id',u.id).is('read_at',null);
      if(error)throw error;
      await loadUpdates();
    }catch(error){feedback('Could not mark account updates as read.');button.disabled=false;}
  });
  $('#date').addEventListener('change',checkBookingDate);
  document.querySelector('#helper-grid')?.addEventListener('click',()=>setTimeout(checkBookingDate,0));
  $('#clear-provider')?.addEventListener('click',()=>setTimeout(checkBookingDate,0));
  return {refresh,reset,canRequest,get ready(){return ready;},checkBookingDate};
}
