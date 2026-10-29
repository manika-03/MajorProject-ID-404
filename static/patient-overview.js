'use strict';
const byId=id=>document.getElementById(id);
const dateFormat=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
let refreshing=false;
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function dateNode(value,className){const node=element('time',dateFormat.format(new Date(value))+' IST',className);node.dateTime=value;return node;}
function status(message,error=false){const node=byId('overview-status');node.textContent=message;node.classList.toggle('error',error);}
async function api(path,options={}){
  const response=await fetch(path,{signal:AbortSignal.timeout(10000),...options,headers:{'Content-Type':'application/json',...(options.headers || {})}});
  const data=await response.json();if(!response.ok)throw Error(data.error || 'The request could not be completed. Please try again.');return data;
}
function action(label,kind,id,description){const node=element('button',label);node.type='button';node.dataset.action=kind;node.dataset.id=id;node.setAttribute('aria-label',`${label}: ${description}`);return node;}
function renderList(id,rows,empty,render){const host=byId(id);host.replaceChildren(...(rows.length ? rows.map(render) : [element('p',empty,'empty-state')]));}
function render(data){
  byId('patient-name').textContent=data.patient.name;byId('patient-code').textContent=data.patient.code;
  byId('appointment-count').textContent=data.appointments.length;byId('medication-count').textContent=data.medications.length;
  byId('reminder-count').textContent=data.reminders.filter(row=>!row.acknowledged_at).length;
  byId('request-count').textContent=data.requests.filter(row=>!row.acknowledged_at).length;
  renderList('appointment-list',data.appointments,'No saved appointments for this patient.',row=>{
    const card=element('article',undefined,'care-record');
    card.append(dateNode(row.starts_at,'record-kicker'),element('h3',row.doctor),element('p',row.department),element('p',row.room,'record-location'));
    if(new Date(row.starts_at)<new Date(data.server_time))card.append(element('span','Past saved visit','record-badge'));
    return card;
  });
  renderList('medication-list',data.medications,'No saved medication instructions for this patient.',row=>{
    const card=element('article',undefined,'care-record medication-record');card.append(element('span',row.time_label,'record-kicker'),element('h3',row.name),element('p',row.instruction));return card;
  });
  renderList('reminder-list',data.reminders,'No reminders yet. Add one below or use the voice assistant.',row=>{
    const card=element('article',undefined,'care-record'),actions=element('div',undefined,'record-actions');
    card.append(element('span',row.acknowledged_at ? 'Dismissed' : row.due ? 'Due now' : 'Upcoming',`record-badge${row.due ? ' due' : ''}`),element('h3',row.label),dateNode(row.due_at));
    if(row.due)actions.append(action('Dismiss alert','dismiss-reminder',row.id,row.label));
    actions.append(action('Remove','remove-reminder',row.id,row.label));card.append(actions);return card;
  });
  renderList('assistance-list',data.requests,'No staff assistance requests recorded.',row=>{
    const card=element('article',undefined,'care-record');card.append(element('span',row.acknowledged_at ? 'Acknowledged' : 'Awaiting acknowledgement','record-badge'),element('h3',row.message),dateNode(row.created_at));
    if(!row.acknowledged_at){const actions=element('div',undefined,'record-actions');actions.append(action('Acknowledge request','acknowledge-request',row.id,row.message));card.append(actions);}return card;
  });
}
async function refresh(announce=false){
  if(refreshing)return false;refreshing=true;byId('overview-refresh').disabled=true;
  try{render(await api('/api/patient-overview'));if(announce)status('Patient information updated. All dates and times are in India time (IST).');return true;}
  catch(error){status('Could not refresh. The information below may be out of date. '+error.message,true);return false;}
  finally{refreshing=false;byId('overview-refresh').disabled=false;}
}
byId('overview-refresh').addEventListener('click',()=>refresh(true));
byId('overview-text').addEventListener('click',event=>{
  const enabled=document.body.classList.toggle('overview-large');event.currentTarget.setAttribute('aria-pressed',String(enabled));
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const id=Number(button.dataset.id),kind=button.dataset.action;if(!Number.isSafeInteger(id) || id<1)return;
  const endpoint=kind==='acknowledge-request' ? `/api/assistance/${id}/acknowledge` : `/api/reminders/${id}${kind==='dismiss-reminder' ? '/acknowledge' : ''}`;
  button.disabled=true;
  try{
    const result=await api(endpoint,{method:kind==='remove-reminder' ? 'DELETE' : 'POST',body:'{}'});
    await refresh();status(result.message);
    const heading=byId(kind==='acknowledge-request' ? 'assistance-title' : 'reminders-title');heading.tabIndex=-1;heading.focus({preventScroll:true});
  }catch(error){status(error.message,true);button.disabled=false;}
});
byId('overview-reminder-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type="submit"]');
  const label=byId('reminder-label').value.trim(),time=byId('reminder-time').value;
  // datetime-local has no zone; explicitly attach India time on every device.
  const due=new Date(time+':00+05:30');
  if(!label || !Number.isFinite(due.getTime()) || due<=new Date()){status('Enter a reminder and choose a future date and time in India time.',true);return;}
  submit.disabled=true;
  try{
    const result=await api('/api/reminders',{method:'POST',body:JSON.stringify({label,due_at:due.toISOString()})});
    form.reset();await refresh();status(result.message+' Open and activate the voice assistant to hear the alert.');
  }catch(error){status(error.message,true);}
  finally{submit.disabled=false;}
});
setInterval(()=>{
  // Never replace a record while a keyboard/screen-reader user is operating it.
  if(!document.hidden && !document.activeElement.closest('.record-list,form'))refresh();
},15000);
