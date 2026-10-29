'use strict';
let previous = '', refreshing = false;
async function refreshRequests() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch('/api/assistance');
    if (!response.ok) throw new Error('Could not load requests.');
    const data = await response.json();
    const state = JSON.stringify(data.requests);
    const host = document.getElementById('request-list');
    document.getElementById('staff-status').textContent = 'Connected · updates every 5 seconds';
    document.getElementById('staff-status').classList.remove('connection-error');
    // Preserve keyboard focus when nothing changed during background refresh.
    if (state === previous) return;
    previous = state; host.replaceChildren();
    if (!data.requests.length) {
      const empty = document.createElement('p'); empty.className='empty-state'; empty.textContent='All quiet for now. Confirm a staff assistance request from the patient screen to see it here.'; host.append(empty);
    }
    data.requests.forEach(row => {
      const card=document.createElement('article'); card.className='card staff-request';
      const content=document.createElement('div'), title=document.createElement('h3'), details=document.createElement('p'), status=document.createElement('span');
      title.textContent=`Request #${row.id} · ${row.name}`;
      details.textContent=`${row.message} ${row.code} · ${new Date(row.created_at).toLocaleString('en-IN')}`;
      status.className='request-status'; status.textContent=row.acknowledged_at ? `Acknowledged ${new Date(row.acknowledged_at).toLocaleString('en-IN')}` : 'Pending acknowledgement';
      content.append(title,details,status); card.append(content);
      if (!row.acknowledged_at) {
        const button=document.createElement('button'); button.className='button button-primary'; button.textContent='Acknowledge request';
        button.addEventListener('click',async () => {
          button.disabled=true;
          try {
            const result=await fetch(`/api/assistance/${row.id}/acknowledge`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
            if (!result.ok) throw new Error('Could not acknowledge this request. Please retry.');
            await refreshRequests();
          } catch(error) { const toast=document.getElementById('toast'); toast.textContent=error.message; toast.hidden=false; setTimeout(()=>{toast.hidden=true;},6000); button.disabled=false; }
        }); card.append(button);
      }
      host.append(card);
    });
  } catch {
    const status=document.getElementById('staff-status'); status.textContent='Connection lost · retrying'; status.classList.add('connection-error');
  } finally { refreshing=false; }
}
refreshRequests(); setInterval(refreshRequests,5000);
