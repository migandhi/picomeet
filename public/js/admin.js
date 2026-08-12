const $ = s => document.querySelector(s);
const api = (u, m, b) => fetch(u, { method: m || 'GET', headers: { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
async function load() {
  const [live, users] = await Promise.all([api('/api/admin/live'), api('/api/admin/users')]);
  if (users.error) return location.href = '/login.html';
  $('#stats').innerHTML = `
    <b>${live.rooms.length}</b>/${live.limits.maxMeetings} live meetings ·
    <b>${live.rooms.reduce((a,r)=>a+r.n,0)}</b>/${live.limits.maxParticipants} participants ·
    RSS <b>${live.server.rssMB} MB</b> · uptime ${Math.round(live.server.uptime/3600)}h ·
    30-day: ${live.usage30d.meetings} meetings, ${(live.usage30d.psec/3600).toFixed(1)} participant-hours,
    ${(live.usage30d.bytes/1048576).toFixed(1)} MB signalling`;
  $('#live').innerHTML = live.rooms.map(r => `<div class="prow">
    <span>${r.name} <code>${r.code}</code> · ${r.owner} · ${r.n}/${r.cap} · ${r.mode}${r.locked?' 🔒':''}</span>
    <button class="mini" data-end="${r.code}">End</button></div>`).join('') || '<p class="muted">No live meetings.</p>';
  document.querySelectorAll('[data-end]').forEach(b => b.onclick = async () => {
    if (confirm('End meeting ' + b.dataset.end + '?')) { await api('/api/admin/rooms/'+b.dataset.end+'/end','POST'); load(); }
  });
  $('#users').innerHTML = users.users.map(u => `<tr>
    <td>${u.username}</td><td>${u.name}</td>
    <td><select data-f="role" data-id="${u.id}">${['admin','host','user'].map(r=>`<option ${r===u.role?'selected':''}>${r}</option>`).join('')}</select></td>
    <td><input size="2" data-f="maxRooms" data-id="${u.id}" value="${u.maxRooms}"></td>
    <td><input size="2" data-f="maxParticipants" data-id="${u.id}" value="${u.maxParticipants}"></td>
    <td><input size="3" data-f="maxMinutes" data-id="${u.id}" value="${u.maxMinutes}"></td>
    <td><input type="date" data-f="expiresAt" data-id="${u.id}" value="${u.expiresAt?new Date(u.expiresAt*1000).toISOString().slice(0,10):''}"></td>
    <td><input type="checkbox" data-f="active" data-id="${u.id}" ${u.active?'checked':''}></td>
    <td><button class="mini" data-del="${u.id}">✕</button>
        <button class="mini" data-pw="${u.id}">🔑</button></td></tr>`).join('');
  document.querySelectorAll('[data-f]').forEach(i => i.onchange = async () => {
    const v = i.type==='checkbox' ? i.checked : (i.dataset.f==='expiresAt'
      ? (i.value ? Math.floor(new Date(i.value+'T23:59:59').getTime()/1000) : null) : i.value);
    await api('/api/admin/users/'+i.dataset.id, 'PATCH', { [i.dataset.f]: v });
    load();
  });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (confirm('Delete this user and all their rooms?')) { await api('/api/admin/users/'+b.dataset.del,'DELETE'); load(); }});
  document.querySelectorAll('[data-pw]').forEach(b => b.onclick = async () => {
    const p = prompt('New password (8+ chars)'); if (p) { await api('/api/admin/users/'+b.dataset.pw,'PATCH',{password:p}); alert('Changed.'); }});
}
$('#create').onclick = async () => {
  const body = { username:$('#nu').value, name:$('#nn').value, password:$('#np').value,
    role:$('#nr').value, maxRooms:+$('#nmr').value, maxParticipants:+$('#nmp').value, maxMinutes:+$('#nmm').value };
  const j = await api('/api/admin/users','POST',body);
  if (j.error) return alert(j.error);
  ['#nu','#nn','#np'].forEach(s=>$(s).value=''); load();
};
load(); setInterval(load, 10000);
