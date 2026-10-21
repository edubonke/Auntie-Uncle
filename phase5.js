/* Auntie & Uncle Phase 5A: booking slots and helper-approved reschedules.
   Optional enhancement: Phase 3/4 continue working until SQL migration is applied.
   Privacy and overlap enforcement MUST remain in Supabase, not this module. */
export function createPhase5({supabase,currentUser,selectedHelper,feedback,refreshAccount,redrawBookings}) {
  const $=s=>document.querySelector(s);
  const el=(tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=String(text);if(cls)node.className=cls;return node;};
  const picker=$('#phase5-time-slots'),options=$('#phase5-slot-options');
  const setup=$('#phase5-setup-note'),info=$('#phase5-slot-message');
  let ready=false,loading=false,checkedUser=null,requests=new Map(),queryToken=0,busy=[];
  let busyKey='';
  const pad=x=>String(x).padStart(2,'0');
  const formatDateSA=()=>{
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  };
  const nowMinutesSA=()=>{
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return Number(p.hour)*60+Number(p.minute);
  };
  const minutes=s=>{
    const match=/^(\d\d):(\d\d)/.exec(String(s||''));
    return match?Number(match[1])*60+Number(match[2]):NaN;
  };
  const hhmm=n=>pad(Math.floor(n/60))+':'+pad(n%60);
  const scheduleError=error=>{
    const code=String(error?.code||'');
    const message=String(error?.message||'').toLowerCase();
    if(code==='23P01'||message.includes('already booked')||message.includes('exclusion constraint'))
      return 'That time is already booked. Choose another start time or date.';
    if(message.includes('unavailable on selected date'))
      return 'The helper is unavailable on this date. Choose another date.';
    if(message.includes('no longer pending')||message.includes('cannot be rescheduled'))
      return 'This request is no longer available. Refresh your dashboard.';
    if(message.includes('within the next 90 days')||message.includes('valid date')||message.includes('future same-day'))
      return 'Choose a future date within 90 days and a valid 30-minute time slot.';
    if(code==='23505')return 'A reschedule request is already pending for this booking.';
    return 'Scheduling could not be completed. Please refresh and try again.';
  };
  const isBooked=(start,end,intervals)=>intervals.some(b=>start<minutes(b.busy_end)&&minutes(b.busy_start)<end);
  function reset(){
    ready=false;checkedUser=null;requests=new Map();busy=[];busyKey='';queryToken++;
    picker.hidden=true;setup.hidden=true;setup.textContent='Advanced scheduling is awaiting the Phase 5 database upgrade. Existing booking requests still work.';
  }
  async function fetchBusy(helperId,date){
    const response=await supabase.rpc('get_helper_busy_slots',{p_helper_id:helperId,p_date:date});
    if(response.error)throw response.error;
    return response.data??[];
  }
  async function renderSlots(){
    const selected=selectedHelper(),date=$('#date').value,hours=Number($('#booking-hours').value);
    const request=++queryToken;
    picker.hidden=true;options.replaceChildren();busy=[];busyKey='';
    if(!ready||!selected?.isLive||!date||!hours||hours<1||hours>12)return;
    const length=Math.round(hours*60);
    picker.hidden=false;info.textContent='Loading accepted bookings for this date…';
    try{
      const intervals=await fetchBusy(selected.id,date);
      if(request!==queryToken)return;
      busy=intervals;busyKey=selected.id+':'+date;
      let available=0;
      for(let start=7*60;start<=20*60;start+=30){
        const end=start+length;
        if(end>24*60)continue;
        const past=date===formatDateSA() && start<=nowMinutesSA();
        const unavailable=past||isBooked(start,end,intervals);
        const button=el('button',hhmm(start),unavailable?'phase5-slot phase5-busy':'phase5-slot');
        button.type='button';button.disabled=unavailable;
        button.setAttribute('aria-label',hhmm(start)+(unavailable?' unavailable':' available to request'));
        button.setAttribute('aria-pressed',String($('#booking-time').value===hhmm(start)));
        if(!unavailable)available++;
        button.addEventListener('click',()=>{
          $('#booking-time').value=hhmm(start);
          for(const other of options.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===button));
          info.textContent='Selected '+hhmm(start)+' SAST. The booking is only confirmed after helper acceptance.';
        });
        options.append(button);
      }
      info.textContent=available?
        available+' suggested start times. Busy intervals exclude accepted bookings only; pending requests may overlap.':
        'No suggested start times remain for this date and duration.';
    }catch(error){
      if(request!==queryToken)return;
      options.replaceChildren();busy=[];busyKey='';
      info.textContent='Could not check busy times. Try Refresh data before booking.';
      console.warn('[Auntie & Uncle] Busy time lookup:',error?.code||'unknown');
    }
  }
  async function refresh(){
    const u=currentUser();
    if(!u){reset();return;}
    if(loading)return;
    loading=true;
    try{
      const {error:probeError}=await supabase.from('booking_reschedule_requests').select('id').limit(1);
      if(probeError){
        ready=false;setup.hidden=false;picker.hidden=true;requests=new Map();
        setup.textContent='Phase 5 advanced scheduling is not active yet. Apply the Phase 5 SQL migration; existing bookings still work.';
        return;
      }
      ready=true;checkedUser=u.id;setup.hidden=true;
      const {data,error}=await supabase.from('booking_reschedule_requests')
        .select('id,booking_id,proposed_date,proposed_time,proposed_hours,reason,status,created_at')
        .order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      requests=new Map();
      for(const item of data??[])if(!requests.has(item.booking_id))requests.set(item.booking_id,item);
      redrawBookings();await renderSlots();
    }catch(error){
      ready=false;setup.hidden=false;picker.hidden=true;
      setup.textContent='Advanced scheduling could not be loaded. Existing booking features remain available.';
      console.warn('[Auntie & Uncle] Scheduling setup:',error?.code||'unknown');
    }finally{loading=false;}
  }
  async function checkBeforeBooking(helper){
    if(!ready)return {ok:true}; // Schema is not yet active: preserve Phase 3/4 booking behaviour.
    const date=$('#date').value,time=$('#booking-time').value;
    const h=Number($('#booking-hours').value),start=minutes(time);
    if(!date||!time||!$('#booking-hours').value)
      return {ok:false,message:'Choose a date, a start time and estimated duration.'};
    if(date<formatDateSA())return {ok:false,message:'Choose a future booking date.'};
    const limit=new Date(formatDateSA()+'T12:00:00');limit.setDate(limit.getDate()+90);
    const maxDate=limit.getFullYear()+'-'+pad(limit.getMonth()+1)+'-'+pad(limit.getDate());
    if(date>maxDate)return {ok:false,message:'Choose a date within the next 90 days.'};
    if(!Number.isFinite(start)||start%30!==0)
      return {ok:false,message:'Choose a start time in 30-minute increments.'};
    if(!Number.isFinite(h)||h<1||h>12||h*2!==Math.trunc(h*2)||start+h*60>1440)
      return {ok:false,message:'Choose 1–12 hours in half-hour steps, ending on the same day.'};
    if(date===formatDateSA()&&start<=nowMinutesSA())
      return {ok:false,message:'Choose a future start time.'};
    try{
      const intervals=busyKey===helper.id+':'+date?busy:await fetchBusy(helper.id,date);
      if(isBooked(start,start+h*60,intervals))
        return {ok:false,message:'This time overlaps an accepted booking. Choose another slot.'};
    }catch{
      return {ok:false,message:'Unable to check busy times. Try again once the connection is available.'};
    }
    return {ok:true};
  }
  function enhanceBookingCard(card,row,view){
    if(!ready||!['pending','accepted'].includes(row.status))return;
    const r=requests.get(row.id);
    if(r){
      const label=r.status==='pending'?'Reschedule pending helper review':
        r.status==='accepted'?'Last reschedule accepted':'Last reschedule declined';
      card.append(el('p',label+': '+r.proposed_date+' '+String(r.proposed_time).slice(0,5)+
        ' · '+r.proposed_hours+' hour(s)','phase5-reschedule-status'));
    }
    if(view==='helper' && r?.status==='pending'){
      const actions=el('div','','booking-actions');
      for(const accept of [true,false]){
        const button=el('button',accept?'Approve new time':'Decline new time',
          'button button-'+(accept?'dark':'outline')+' button-small');
        button.type='button';
        button.addEventListener('click',async()=>{
          if(!confirm(accept?'Apply this new time to the booking?':'Decline the new time and keep the original schedule?'))return;
          button.disabled=true;
          try{
            const {error}=await supabase.rpc('decide_booking_reschedule',
              {p_request_id:r.id,p_accept:accept});
            if(error)throw error;
            feedback(accept?'Reschedule approved.':'Reschedule declined.');
            await refreshAccount();
          }catch(error){feedback(scheduleError(error));button.disabled=false;}
        });
        actions.append(button);
      }
      card.append(actions);
    }
    if(view!=='customer'||r?.status==='pending')return;
    const reveal=el('button','Request different time','button button-outline button-small');
    reveal.type='button';
    const form=el('form','','phase5-reschedule-form');form.hidden=true;
    form.append(el('strong','Propose a replacement date and time'));
    const fields=el('div','','phase5-reschedule-fields');
    const config=[
      ['date','New date',row.preferred_date],
      ['time','New start time',String(row.preferred_time||'').slice(0,5)],
      ['number','Estimated hours',row.estimated_hours||2]
    ];
    const inputs=[];
    for(const [type,label,value] of config){
      const wrap=el('label',label,'phase5-reschedule-label');
      const input=document.createElement('input');input.type=type;input.required=true;input.value=String(value);
      if(type==='date')input.min=formatDateSA();
      if(type==='time')input.step=1800;
      if(type==='number'){input.min='1';input.max='12';input.step='0.5';}
      wrap.append(input);fields.append(wrap);inputs.push(input);
    }
    const reasonLabel=el('label','Reason (10–350 characters)','phase5-reschedule-label');
    const reason=document.createElement('textarea');reason.rows=2;reason.required=true;reason.minLength=10;reason.maxLength=350;
    reason.placeholder='Explain why you need to change the appointment';reasonLabel.append(reason);
    const submit=el('button','Send reschedule request','button button-dark button-small');submit.type='submit';
    form.append(fields,reasonLabel,submit);
    reveal.addEventListener('click',()=>{form.hidden=!form.hidden;reveal.setAttribute('aria-expanded',String(!form.hidden));});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!form.reportValidity())return;
      if(!confirm('Send this proposed time to the helper for approval? The current booking stays unchanged until accepted.'))return;
      submit.disabled=true;
      try{
        const {error}=await supabase.rpc('request_booking_reschedule',{
          p_booking_id:row.id,p_date:inputs[0].value,
          p_time:inputs[1].value,p_hours:Number(inputs[2].value),p_reason:reason.value.trim()
        });
        if(error)throw error;
        feedback('Reschedule requested. The existing booking stays unchanged until the helper approves.');
        await refreshAccount();
      }catch(error){feedback(scheduleError(error));submit.disabled=false;}
    });
    card.append(reveal,form);
  }
  for(const selector of ['#date','#booking-hours']){
    $(selector).addEventListener('change',renderSlots);
    $(selector).addEventListener('input',()=>{if(selector==='#booking-hours')renderSlots();});
  }
  window.addEventListener('auntie:helper-selected',renderSlots);
  $('#booking-time').addEventListener('change',()=>{
    for(const btn of options.querySelectorAll('button'))btn.setAttribute('aria-pressed',
      String(btn.textContent===$('#booking-time').value));
  });
  return {refresh,reset,checkBeforeBooking,enhanceBookingCard,get ready(){return ready;}};
}
