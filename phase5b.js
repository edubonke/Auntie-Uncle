/* Auntie & Uncle Phase 5B — bounded, manually approved recurring requests.
 * Database RPCs own all authorisation, date validation and atomic writes.
 * Absence of migration hides new actions; earlier phases remain unaffected. */
const recurringDateText = date => date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
export function recurringDates(start,kind,quantity){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start) ||
     !['Weekly','Fortnightly','Monthly'].includes(kind) ||
     !Number.isInteger(quantity) || quantity<2 || quantity>8)return [];
  const [y,m,d]=start.split('-').map(Number);
  if(m<1||m>12||d<1||d>new Date(y,m,0,12).getDate())return [];
  const result=[];
  for(let i=0;i<quantity;i++){
    let date;
    if(kind==='Weekly'||kind==='Fortnightly'){
      date=new Date(y,m-1,d+i*(kind==='Weekly'?7:14),12);
    }else{
      const first=new Date(y,m-1+i,1,12);
      const max=new Date(first.getFullYear(),first.getMonth()+1,0,12).getDate();
      date=new Date(first.getFullYear(),first.getMonth(),Math.min(d,max),12);
    }
    result.push(recurringDateText(date));
  }
  return result;
}

export function createPhase5B({supabase,currentUser,selectedHelper,customerBookings,helperBookings,feedback,refreshAccount}) {
  const $=selector=>document.querySelector(selector);
  const make=(tag,text='',klass='')=>{
    const node=document.createElement(tag);node.textContent=String(text??'');
    if(klass)node.className=klass;return node;
  };
  const enabled=$('#phase5b-enable'),panel=$('#phase5b-recurring'),extra=$('#phase5b-options');
  const cadence=$('#phase5b-cadence'),count=$('#phase5b-count');
  const preview=$('#phase5b-preview'),setup=$('#phase5b-setup-note');
  let ready=false,loadedUser=null,pendingKey=null;
  const pad=n=>String(n).padStart(2,'0');
  const ymd=recurringDateText;
  const todaySAST=()=>{
    const parts=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Africa/Johannesburg'}).formatToParts(new Date());
    const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return fields.year+'-'+fields.month+'-'+fields.day;
  };

  const recurrenceDates=recurringDates;
  const minutes=str=>{
    const m=/^(\d{2}):(\d{2})/.exec(str||'');
    return m?Number(m[1])*60+Number(m[2]):NaN;
  };
  function updatePreview(){
    preview.replaceChildren();
    if(!ready||!enabled.checked||!selectedHelper()?.isLive)return;
    const date=$('#date').value,hours=Number($('#booking-hours').value),
      start=minutes($('#booking-time').value),n=Number(count.value);
    if(!date){preview.append(make('p','Choose a preferred first date to preview your visits.','form-small'));return;}
    if(!Number.isInteger(n)||n<2||n>8){
      preview.append(make('p','Select between 2 and 8 visits.','form-error'));return;
    }
    const dates=recurrenceDates(date,cadence.value,n);
    if(!dates.length)return;
    const cutoff=new Date(todaySAST()+'T12:00:00');cutoff.setDate(cutoff.getDate()+90);
    const max=ymd(cutoff);
    const invalid=dates.some(x=>x<todaySAST()||x>max);
    const list=make('ol','','phase5b-date-list');
    for(const day of dates)list.append(make('li',day));
    preview.append(make('strong',n+' proposed appointments · '+cadence.value),list);
    if(invalid)preview.append(make('p','At least one date falls outside the next 90 days. Choose an earlier start date or fewer visits.','phase5b-warning'));
    if(!Number.isFinite(start)||start%30!==0||!hours||hours<1||hours>12||hours*2!==Math.trunc(hours*2)||start+hours*60>1440)
      preview.append(make('p','Choose a half-hour start time and a duration of 1–12 hours finishing on the same day.','phase5b-warning'));
    preview.append(make('p','Blocked dates and accepted-booking conflicts are checked by the database for every visit.','form-small'));
  }
  function invalidate(){
    pendingKey=null;
    updatePreview();
  }
  function reset(){
    ready=false;loadedUser=null;pendingKey=null;
    enabled.checked=false;extra.hidden=true;panel.hidden=true;setup.hidden=true;
    $('#phase5b-customer-series').hidden=true;$('#phase5b-helper-series').hidden=true;
    preview.replaceChildren();
  }
  const isRecurring=()=>ready&&enabled.checked;
  function validation(){
    if(!isRecurring())return {ok:false,message:'Recurring appointments are not activated yet.'};
    if(!selectedHelper()?.isLive)return {ok:false,message:'Select an approved helper first.'};
    const start=$('#date').value,time=$('#booking-time').value,hours=Number($('#booking-hours').value);
    const qty=Number(count.value),details=$('#details').value.trim(),area=$('#area').value.trim();
    if(!['Weekly','Fortnightly','Monthly'].includes(cadence.value)||!Number.isInteger(qty)||qty<2||qty>8)
      return {ok:false,message:'Choose weekly, fortnightly or monthly service and 2–8 appointments.'};
    if(area.length<2||area.length>80||details.length<10||details.length>650)
      return {ok:false,message:'Complete the area and service description (at least 10 characters).'};
    if(!start||!time||!$('#booking-hours').value)
      return {ok:false,message:'Choose a first date, start time and service duration.'};
    const startMinutes=minutes(time);
    if(!Number.isFinite(startMinutes)||startMinutes%30!==0||!Number.isFinite(hours)||hours<1||hours>12||hours*2!==Math.trunc(hours*2)||startMinutes+hours*60>1440)
      return {ok:false,message:'Use half-hour times and a duration of 1–12 hours ending the same day.'};
    const dates=recurrenceDates(start,cadence.value,qty);
    const end=new Date(todaySAST()+'T12:00:00');end.setDate(end.getDate()+90);
    if(dates.length!==qty||dates.some(d=>d<todaySAST()||d>ymd(end)))
      return {ok:false,message:'All requested dates must fall within the next 90 days.'};
    const args={p_helper_id:selectedHelper().id,p_service:$('#service').value,
      p_area:area,p_start_date:start,p_start_time:time,p_hours:hours,p_details:details,
      p_cadence:cadence.value,p_occurrences:qty,p_request_key:pendingKey||crypto.randomUUID()};
    pendingKey=args.p_request_key;
    return {ok:true,args,dates};
  }
  async function create(){
    const check=validation();
    if(!check.ok)return {ok:false,message:check.message};
    try{
      const {data,error}=await supabase.rpc('request_recurring_bookings',check.args);
      if(error)throw error;
      // A successful RPC created ALL pending rows atomically. Clear the key only
      // after success, so a network retry can safely reuse the original request.
      pendingKey=null;
      return {ok:true,id:data,count:check.dates.length,dates:check.dates};
    }catch(error){
      console.warn('[Auntie & Uncle] Series request:',error?.code||'unknown');
      const message=error?.code==='23505'?'This series has already been requested. Refresh your bookings.':
        'Recurring requests could not be created. Check that all proposed dates are available and try again.';
      return {ok:false,message};
    }
  }
  function renderSeries(root,rows,bookings,isCustomer){
    root.replaceChildren();
    if(!rows.length){root.append(make('p','No recurring series yet.','empty-state'));return;}
    for(const series of rows){
      const card=make('article','','booking-item booking-card');
      const header=make('div','','booking-topline');
      header.append(make('strong',series.service+' · '+series.cadence+' · '+series.area),
        make('span',series.status,'status-chip status-'+(series.status==='cancelled'?'cancelled':'pending')));
      const mine=bookings.filter(b=>b.series_id===series.id);
      const accepted=mine.filter(b=>b.status==='accepted').length;
      const pending=mine.filter(b=>b.status==='pending').length;
      const cancelled=mine.filter(b=>b.status==='cancelled').length;
      card.append(header,make('p',series.occurrence_count+' visits · from '+series.first_date+
        ' · '+String(series.start_time).slice(0,5)+' SAST','booking-meta'),
        make('p','In the loaded booking history: '+accepted+' accepted, '+pending+
          ' pending, '+cancelled+' cancelled. Each visit needs individual helper approval.','form-small'));
      if(isCustomer&&series.status==='active'){
        const cancel=make('button','Cancel remaining visits','button button-outline button-small');
        cancel.type='button';
        cancel.addEventListener('click',async()=>{
          if(!confirm('Cancel all remaining future Pending/Accepted visits in this series? Past visits stay unchanged.'))return;
          cancel.disabled=true;
          try{
            const {data,error}=await supabase.rpc('cancel_recurring_series',{p_series_id:series.id});
            if(error)throw error;
            feedback('Series cancelled. '+data+' remaining future appointments were cancelled.');
            await refreshAccount();
          }catch(error){
            console.warn('[Auntie & Uncle] Cancel series:',error?.code||'unknown');
            feedback('Could not cancel this series. Refresh your dashboard and try again.');
            cancel.disabled=false;
          }
        });
        card.append(cancel);
      }
      root.append(card);
    }
  }
  async function refresh(){
    const user=currentUser();if(!user){reset();return;}
    const {error:probeError}=await supabase.from('recurring_booking_series').select('id').limit(1);
    if(probeError){
      ready=false;setup.hidden=false;panel.hidden=true;
      $('#phase5b-customer-series').hidden=true;$('#phase5b-helper-series').hidden=true;
      setup.textContent='Recurring appointments are awaiting Phase 5B database activation. Single appointments still work.';
      return;
    }
    ready=true;loadedUser=user.id;panel.hidden=false;setup.hidden=true;
    const {data,error}=await supabase.from('recurring_booking_series')
      .select('id,customer_id,helper_id,service,area,cadence,occurrence_count,first_date,start_time,status,created_at')
      .order('created_at',{ascending:false}).limit(60);
    if(error){feedback('Could not load recurring series.');return;}
    const series=data??[],customer=series.filter(s=>s.customer_id===user.id),
      helper=series.filter(s=>s.customer_id!==user.id);
    // Read only series links + statuses, subject to the existing booking RLS.
    // The legacy booking queries stay schema-compatible before migration.
    let occurrenceRows=[];
    if(series.length){
      const ids=series.map(s=>s.id);
      const response=await supabase.from('bookings').select('series_id,status')
        .in('series_id',ids).limit(500);
      if(response.error){feedback('Could not load recurring visit counts.');return;}
      occurrenceRows=response.data??[];
    }
    $('#phase5b-customer-series').hidden=false;
    renderSeries($('#phase5b-customer-series-list'),customer,occurrenceRows,true);
    const asHelper=helperBookings();
    $('#phase5b-helper-series').hidden=!asHelper.active;
    if(asHelper.active)renderSeries($('#phase5b-helper-series-list'),helper,occurrenceRows,false);
    updatePreview();
  }
  enabled.addEventListener('change',()=>{
    extra.hidden=!enabled.checked;
    if(enabled.checked && ['Weekly','Fortnightly','Monthly'].includes($('#frequency').value))cadence.value=$('#frequency').value;
    invalidate();
  });
  for(const item of [cadence,count,$('#date'),$('#booking-time'),$('#booking-hours'),$('#area'),$('#details'),$('#service'),$('#frequency')]){
    item.addEventListener('change',invalidate);
    if(item===count)item.addEventListener('input',invalidate);
  }
  window.addEventListener('auntie:helper-selected',invalidate);
  return {refresh,reset,create,isRecurring,updatePreview};
}
