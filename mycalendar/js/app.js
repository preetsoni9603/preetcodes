/*
 * My Calendar — app script for preetcodes.com/mycalendar.
 * Talks to index.php (?action=data|write|settings|gevents|gsyncall).
 */
(function(){
const LS_TASKS='mycal.tasks.v1', LS_DISMISS='mycal.dismissed.v1', LS_TOASTED='mycal.toasted.v1', LS_VIEW='mycal.calview.v1';
function lsGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const startOfDay=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
const parseDay=s=>new Date(s+'T00:00:00');
const ICON={
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  undo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  alert:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  left:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
  google:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/></svg>',
  right:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>'
};
const PRI={urgent:'Urgent',high:'High',normal:'Normal',low:'Low'};
const REMIND=[[0,'At the due time'],[10,'10 minutes before'],[30,'30 minutes before'],[60,'1 hour before'],[180,'3 hours before'],[1440,'1 day before']];
const DEFAULT_DEPTS=['School','Work','Personal','Job Search'];
const KNOWN_COLORS={'School':'#2dd1be','Work':'#ff8466','Personal':'#a78bfa','Job Search':'#f5b942'};
const EXTRA_COLORS=['#5aa9ff','#f472b6','#9bd250','#e0a96d','#7dd3fc','#c4b5fd'];
function deptColor(d){d=d||'Personal';if(KNOWN_COLORS[d])return KNOWN_COLORS[d];let h=0;for(const c of d)h=(h*31+c.charCodeAt(0))>>>0;return EXTRA_COLORS[h%EXTRA_COLORS.length]}
const deptOf=t=>t.department||'Personal';
const LS_DEPTS='mycal.depts.v1';
let deptList=lsGet(LS_DEPTS,null)||DEFAULT_DEPTS.slice();
let tasks=lsGet(LS_TASKS,[]);
let mode='pending', rev=0, google={configured:false,connected:false,curl:true};
let gEvents=[], gRange='', gAt=0;
let page='dashboard';
let calView=lsGet(LS_VIEW,'month'); if(!['month','week','day','list'].includes(calView))calView='month';
let calDate=startOfDay(new Date());
let deptFilter='all', showDone=false;
async function saveDepts(list){
  deptList=list; lsSet(LS_DEPTS,list); renderAll();
  try{await write([{op:'set',coll:'meta',id:'main',data:{departments:list}}])}catch(e){toast('Could not save departments. '+(e.message||''))}
}

/* ---------- time helpers ---------- */
function dueAt(t){return new Date((t.due||ymd(new Date()))+'T'+(t.time||'23:59')+':00')}
function fmtTime(t){if(!t.time)return 'All day';const [h,m]=t.time.split(':').map(Number);const ap=h>=12?'PM':'AM';return ((h%12)||12)+(m?':'+pad(m):'')+' '+ap}
function fmtShort(t){if(!t.time)return '';const [h,m]=t.time.split(':').map(Number);return ((h%12)||12)+(m?':'+pad(m):'')+(h>=12?'p':'a')}
function relDay(dateStr){
  const d=startOfDay(parseDay(dateStr)), t=startOfDay(new Date());
  const diff=Math.round((d-t)/864e5);
  if(diff===0)return 'Today'; if(diff===1)return 'Tomorrow'; if(diff===-1)return 'Yesterday';
  if(diff>1&&diff<7)return d.toLocaleDateString(undefined,{weekday:'long'});
  return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
}
function fmtDue(t){return relDay(t.due)+' · '+fmtTime(t)}
function untilText(ms){
  const a=Math.abs(ms), m=Math.round(a/6e4);
  let s; if(m<60)s=m+' min'; else if(m<1440){const h=Math.floor(m/60),r=m%60;s=h+' hr'+(r?' '+r+' min':'')} else {const d=Math.round(m/1440);s=d+' day'+(d>1?'s':'')}
  return ms>=0?'in '+s:s+' ago';
}
const sortByDue=(a,b)=>dueAt(a)-dueAt(b);
/* multi-day tasks: `start` (YYYY-MM-DD) is optional; `due` is the end date */
const startOf=t=>t.start&&t.start<t.due?t.start:t.due;
const isMulti=t=>startOf(t)!==t.due;
const spansDay=(t,key)=>startOf(t)<=key&&key<=t.due;
const dayDiff=(a,b)=>Math.round((parseDay(b)-parseDay(a))/864e5);
const dayCount=t=>dayDiff(startOf(t),t.due)+1;
const shortDate=k=>parseDay(k).toLocaleDateString(undefined,{month:'short',day:'numeric'});
function spanText(t){return shortDate(startOf(t))+' – '+shortDate(t.due)+' · '+dayCount(t)+' days'}
function dayOfText(t,key){return 'Day '+(dayDiff(startOf(t),key)+1)+' of '+dayCount(t)}
const isOver=t=>!t.done&&dueAt(t)<new Date();
function allDepts(){const s=new Set(deptList);tasks.forEach(t=>s.add(deptOf(t)));return [...s]}
function deptCount(d){return tasks.filter(t=>deptOf(t)===d).length}

/* ---------- storage (your server) ---------- */
async function api(action,body,extra=''){
  let r;
  try{
    r=await fetch('./?action='+action+extra,{method:body?'POST':'GET',
      headers:body?{'Content-Type':'application/json','X-MyCal':'1'}:{'X-MyCal':'1'},
      body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
  }catch(e){throw {code:'network',message:'Couldn’t reach your website. Check your internet connection.'}}
  if(r.status===401){location.reload();throw {code:'signed_out',message:'You were signed out.'}}
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j||j.ok===false)throw {code:(j&&j.code)||'unavailable',message:(j&&j.error)||'The server had a problem. Try again.'};
  return j;
}
function setStore(m){
  mode=m;
  const dot=document.getElementById('storeDot'), txt=document.getElementById('storeTxt');
  if(m==='server'){dot.classList.add('live');txt.textContent='Synced to your website'}
  else{dot.classList.remove('live');txt.textContent='Offline · showing your last saved copy'}
}
async function pull(force){
  try{
    const j=await api('data',null,force?'':'&since='+rev);
    setStore('server');
    if(j.unchanged)return;
    rev=j.rev;
    tasks=Object.entries(j.tasks||{}).map(([id,d])=>Object.assign({},d,{id}));
    const m=(j.meta||{}).main;
    if(m&&Array.isArray(m.departments)&&m.departments.length)deptList=m.departments.slice();
    if(j.google)google=j.google;
    lsSet(LS_TASKS,tasks); lsSet(LS_DEPTS,deptList);
    renderAll();
  }catch(e){if(e.code!=='signed_out')setStore('offline')}
}
async function write(ops){
  const j=await api('write',{ops});
  if(j.gcalErrors)toast('Saved, but Google Calendar didn’t take '+(j.gcalErrors===1?'that change':j.gcalErrors+' changes')+'. Open Settings to check the connection.');
  await pull(true);
  return j;
}
function bodyOf(t){const b={};['name','time','start','due','priority','remind','note','department','done','doneAt','createdAt','snoozeUntil'].forEach(k=>{if(t[k]!==undefined&&t[k]!==null)b[k]=t[k]});return b}
async function saveTask(t){
  if(!t.id)t.id='t'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const i=tasks.findIndex(x=>x.id===t.id); if(i>=0)tasks[i]=t; else tasks.push(t);
  renderAll();
  try{await write([{op:'set',coll:'tasks',id:t.id,data:bodyOf(t)}])}
  catch(e){toast('Could not save “'+t.name+'”. '+(e.message||''));pull(true)}
}
async function removeTask(id){
  const t=tasks.find(x=>x.id===id); if(!t)return;
  tasks=tasks.filter(x=>x.id!==id); renderAll();
  try{await write([{op:'delete',coll:'tasks',id}])}
  catch(e){toast('Could not delete. '+(e.message||''));pull(true);return}
  const copy=Object.assign({},t); delete copy.gcalId; delete copy.gcalErr;
  toast('Deleted “'+t.name+'”',{label:'Undo',fn:()=>saveTask(copy)});
}

/* ---------- Google Calendar events (read-only here) ---------- */
function neededRange(){
  const t=startOfDay(new Date());
  const first=new Date(calDate.getFullYear(),calDate.getMonth(),1);
  const gs=addDays(first,-first.getDay()), ge=addDays(gs,41);
  const from=new Date(Math.min(gs,addDays(calDate,-7),t)), to=new Date(Math.max(ge,addDays(calDate,7),addDays(t,8)));
  return [ymd(from),ymd(to)];
}
async function loadGEvents(force){
  if(!google.connected){gEvents=[];return}
  const [f,t]=neededRange(), key=f+'_'+t;
  if(!force&&key===gRange&&Date.now()-gAt<300000)return;
  gRange=key; gAt=Date.now();
  try{const j=await api('gevents',null,'&from='+f+'&to='+t);gEvents=j.events||[];if(j.google)google=j.google;renderAll()}
  catch(e){gAt=0}
}
const gOn=key=>gEvents.filter(e=>e.date===key);
const gMins=s=>{const [h,m]=s.split(':').map(Number);return h*60+m};
function gLink(e,cls,inner){return `<a class="${cls} g" href="${esc(e.link)}" target="_blank" rel="noopener" data-glink title="${esc(e.title)} · Google Calendar">${inner}</a>`}

/* ---------- alerts on this device ---------- */
let swReg=null;
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').then(r=>{swReg=r}).catch(()=>{})}
function sysNotify(title,body,tag){
  try{
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    if(swReg&&swReg.showNotification){swReg.showNotification(title,{body,tag,icon:'icon.svg'});return}
    new Notification(title,{body,tag,icon:'icon.svg'});
  }catch(e){}
}
function patch(id,changes){const t=tasks.find(x=>x.id===id);if(!t)return;saveTask(Object.assign({},t,changes))}
function toggleDone(id){const t=tasks.find(x=>x.id===id);if(!t)return;patch(id,t.done?{done:false,doneAt:null}:{done:true,doneAt:Date.now()});if(!t.done)toast('Done: '+t.name)}
function moveTomorrow(id){const t=tasks.find(x=>x.id===id);if(!t)return;const base=dueAt(t)<new Date()?new Date():dueAt(t);const nd=ymd(addDays(base,1));patch(id,{due:nd,snoozeUntil:null});toast('Moved to '+relDay(nd))}

/* ---------- notifications ---------- */
function notifKey(kind,t){return kind+':'+t.id+':'+t.due+'T'+(t.time||'')}
function computeNotifs(){
  const now=new Date(), dismissed=lsGet(LS_DISMISS,{}), out=[];
  tasks.filter(t=>!t.done).forEach(t=>{
    if(t.snoozeUntil&&now.getTime()<t.snoozeUntil)return;
    const at=dueAt(t), remindAt=new Date(at.getTime()-(Number(t.remind??30))*6e4);
    let kind=null;
    if(now>at)kind='overdue'; else if(now>=remindAt)kind='soon';
    else if(startOfDay(at).getTime()===startOfDay(now).getTime())kind='today';
    else if(isMulti(t)&&startOf(t)===ymd(now))kind='starts';
    else if(at-now<36*36e5)kind='upcoming';
    if(!kind)return;
    const key=notifKey(kind,t);
    if(dismissed[key])return;
    out.push({kind,key,t,at,ms:at-now});
  });
  out.sort((a,b)=>a.at-b.at);
  return out;
}
function checkReminders(){
  const toasted=lsGet(LS_TOASTED,{}), n=computeNotifs();
  n.filter(x=>x.kind==='soon'||x.kind==='overdue').forEach(x=>{
    if(toasted[x.key])return; toasted[x.key]=Date.now();
    const msg=x.kind==='soon'?'Reminder: '+x.t.name+' is due '+untilText(x.ms)+' ('+fmtTime(x.t)+')':'Overdue: '+x.t.name+' was due '+untilText(x.ms);
    toast(msg,{label:'View',fn:()=>{location.hash='#notifications'}},'rem',9000);
    sysNotify(x.kind==='soon'?'Due '+untilText(x.ms):'Overdue',x.t.name+' · '+deptOf(x.t)+' · '+fmtDue(x.t),x.key);
  });
  lsSet(LS_TOASTED,toasted);
  const count=n.filter(x=>x.kind!=='upcoming').length, b=document.getElementById('navBadge');
  b.textContent=count; b.hidden=!count;
  document.title=(count?'('+count+') ':'')+'My Calendar';
}
function dismiss(key){const d=lsGet(LS_DISMISS,{});d[key]=Date.now();lsSet(LS_DISMISS,d);renderAll()}

/* ---------- toasts ---------- */
function toast(msg,action,cls,ms){
  const host=document.getElementById('toasts'), el=document.createElement('div');
  el.className='toast'+(cls?' '+cls:'');
  const p=document.createElement('p');p.textContent=msg;el.appendChild(p);
  if(action){const b=document.createElement('button');b.textContent=action.label;b.onclick=()=>{action.fn();el.remove()};el.appendChild(b)}
  host.appendChild(el); setTimeout(()=>el.remove(),ms||5000);
  while(host.children.length>3)host.firstChild.remove();
}

/* ---------- modal ---------- */
function openForm(t,preset){
  const editing=!!t;
  t=t||Object.assign({name:'',time:'',due:ymd(calDate),priority:'normal',remind:30,note:'',department:deptFilter!=='all'?deptFilter:'School'},preset||{});
  const dept=deptOf(t);
  const host=document.getElementById('modalHost');
  host.innerHTML=`<div class="scrim" id="scrim"><form class="modal" id="taskForm" novalidate>
    <h2>${editing?'Edit task':'New task'}</h2>
    <div class="field"><label for="fName">Name</label><input id="fName" maxlength="120" placeholder="e.g. Graduate Project Design" value="${esc(t.name)}"></div>
    <div class="field"><label for="fDept">Department</label>
      <div class="deptsel"><span class="ddot" id="fDeptDot" style="background:${deptColor(dept)}"></span><select id="fDept">${allDepts().map(d=>`<option value="${esc(d)}"${d===dept?' selected':''}>${esc(d)}</option>`).join('')}<option value="__new">+ New department…</option></select></div>
      <input id="fDeptNew" maxlength="30" placeholder="Name the new department, e.g. Office Ease" hidden></div>
    <div class="row2">
      <div class="field"><label for="fStart">Start date</label><input id="fStart" type="date" value="${esc(t.start||t.due)}"></div>
      <div class="field"><label for="fDue">End date (due)</label><input id="fDue" type="date" value="${esc(t.due)}"></div>
    </div>
    <p class="hint" id="fSpan"></p>
    <div class="field"><label for="fTime">Due time on the end date</label><input id="fTime" type="time" value="${esc(t.time)}"></div>
    <div class="row2">
      <div class="field"><label for="fPri">Priority</label><select id="fPri">${Object.entries(PRI).map(([k,v])=>`<option value="${k}"${t.priority===k?' selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="fRem">Remind me</label><select id="fRem">${REMIND.map(([v,l])=>`<option value="${v}"${Number(t.remind??30)===v?' selected':''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="fNote">Note (optional)</label><textarea id="fNote" maxlength="400" placeholder="Course, link, details">${esc(t.note)}</textarea></div>
    <p class="err" id="fErr" hidden></p>
    <div class="mfoot">${editing?`<button type="button" class="btn spacer" id="fDel">${ICON.trash}Delete</button>`:''}<button type="button" class="btn" id="fCancel">Cancel</button><button type="submit" class="btn primary">${editing?'Save changes':'Add task'}</button></div>
  </form></div>`;
  const close=()=>{host.innerHTML='';document.removeEventListener('keydown',onKey)};
  const onKey=e=>{if(e.key==='Escape')close()};
  document.addEventListener('keydown',onKey);
  document.getElementById('scrim').addEventListener('mousedown',e=>{if(e.target.id==='scrim')close()});
  document.getElementById('fCancel').onclick=close;
  if(editing)document.getElementById('fDel').onclick=()=>{close();removeTask(t.id)};
  const sel=document.getElementById('fDept'), nw=document.getElementById('fDeptNew'), dot=document.getElementById('fDeptDot');
  sel.addEventListener('change',()=>{const isNew=sel.value==='__new';nw.hidden=!isNew;if(isNew){nw.focus();dot.style.background='var(--muted)'}else dot.style.background=deptColor(sel.value)});
  nw.addEventListener('input',()=>{dot.style.background=nw.value.trim()?deptColor(nw.value.trim()):'var(--muted)'});
  const fS=document.getElementById('fStart'), fD=document.getElementById('fDue'), fSpan=document.getElementById('fSpan');
  const showSpan=()=>{const a=fS.value,b=fD.value;if(a&&b&&a<b){fSpan.textContent='Shows on every day from '+shortDate(a)+' to '+shortDate(b)+' ('+(dayDiff(a,b)+1)+' days).';fSpan.hidden=false}else{fSpan.textContent='One-day task. Pick a later end date to spread it over several days.';fSpan.hidden=false}};
  fS.addEventListener('change',()=>{if(fS.value&&(!fD.value||fD.value<fS.value))fD.value=fS.value;showSpan()});
  fD.addEventListener('change',()=>{if(fD.value&&fS.value>fD.value)fS.value=fD.value;showSpan()});
  showSpan();
  document.getElementById('fName').focus();
  document.getElementById('taskForm').addEventListener('submit',e=>{
    e.preventDefault();
    const name=document.getElementById('fName').value.trim(), due=document.getElementById('fDue').value;
    const err=document.getElementById('fErr');
    if(!name){err.textContent='Give the task a name.';err.hidden=false;return}
    if(!due){err.textContent='Pick an end date.';err.hidden=false;return}
    const startVal=fS.value||due;
    if(startVal>due){err.textContent='The start date must be on or before the end date.';err.hidden=false;return}
    let department=sel.value;
    if(department==='__new'){
      department=nw.value.trim();
      if(!department){err.textContent='Type a name for the new department.';err.hidden=false;nw.focus();return}
      const match=allDepts().find(d=>d.toLowerCase()===department.toLowerCase());
      if(match)department=match; else saveDepts(deptList.concat(department));
    }
    const out=Object.assign({},t,{name,due,start:startVal<due?startVal:null,time:document.getElementById('fTime').value||'',department,priority:document.getElementById('fPri').value,remind:Number(document.getElementById('fRem').value),note:document.getElementById('fNote').value.trim(),snoozeUntil:null});
    if(!editing){out.createdAt=Date.now();out.done=false}
    saveTask(out); close(); toast(editing?'Saved changes':'Added “'+name+'”');
  });
}

/* ---------- departments manager ---------- */
function openDepts(){
  const host=document.getElementById('modalHost');
  const draw=()=>{
    const list=allDepts();
    host.innerHTML=`<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-label="Departments">
      <h2>Departments</h2>
      <p class="quiet">Rename a department to update all of its tasks. A department can be removed once it has no tasks.</p>
      <div class="drows">${list.map((d,i)=>{const n=deptCount(d);return `<div class="drow"><span class="ddot" style="background:${deptColor(d)}"></span>
        <input id="dRen${i}" data-orig="${esc(d)}" maxlength="30" value="${esc(d)}" aria-label="Department name">
        <span class="mono dcount">${n} task${n===1?'':'s'}</span>
        <button class="icon-btn sm" data-drm="${esc(d)}" aria-label="Remove ${esc(d)}" ${n?'disabled title="Move or delete its tasks first"':''}>${ICON.trash}</button></div>`}).join('')}</div>
      <div class="drow add"><input id="dNew" maxlength="30" placeholder="New department name"><button class="btn sm" id="dAdd">${ICON.plus}Add</button></div>
      <p class="err" id="dErr" hidden></p>
      <div class="mfoot"><button class="btn" id="dClose">Cancel</button><button class="btn primary" id="dSave">Save names</button></div>
    </div></div>`;
    const err=document.getElementById('dErr');
    document.getElementById('scrim').addEventListener('mousedown',e=>{if(e.target.id==='scrim')host.innerHTML=''});
    document.getElementById('dClose').onclick=()=>host.innerHTML='';
    host.querySelectorAll('[data-drm]').forEach(b=>b.onclick=()=>{const d=b.dataset.drm;if(deptCount(d))return;saveDepts(deptList.filter(x=>x!==d)).then(()=>{toast('Removed '+d);draw()})});
    const add=()=>{const v=document.getElementById('dNew').value.trim();if(!v){err.textContent='Type a department name.';err.hidden=false;return}
      if(allDepts().some(d=>d.toLowerCase()===v.toLowerCase())){err.textContent=v+' already exists.';err.hidden=false;return}
      saveDepts(allDepts().concat(v)).then(()=>{toast('Added '+v);draw()})};
    document.getElementById('dAdd').onclick=add;
    document.getElementById('dNew').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add()}});
    document.getElementById('dSave').onclick=async()=>{
      const inputs=[...host.querySelectorAll('[data-orig]')], names=inputs.map(i=>i.value.trim());
      if(names.some(n=>!n)){err.textContent='Department names can’t be empty.';err.hidden=false;return}
      if(new Set(names.map(n=>n.toLowerCase())).size!==names.length){err.textContent='Two departments have the same name.';err.hidden=false;return}
      const renames=inputs.filter(i=>i.value.trim()!==i.dataset.orig).map(i=>[i.dataset.orig,i.value.trim()]);
      host.innerHTML='';
      await saveDepts(names);
      for(const [from,to] of renames){for(const t of tasks.filter(x=>deptOf(x)===from)){await saveTask(Object.assign({},t,{department:to}))}if(deptFilter===from)deptFilter=to}
      if(renames.length)toast('Renamed '+renames.map(r=>r[0]+' → '+r[1]).join(', '));
    };
  };
  draw();
}

/* ---------- shared bits ---------- */
function priPill(t){return t.priority&&t.priority!=='normal'?`<span class="pill ${t.priority}">${PRI[t.priority]}</span>`:''}
function dtag(t){return `<span class="dtag"><span class="ddot" style="background:${deptColor(deptOf(t))}"></span>${esc(deptOf(t))}</span>`}
function headHTML(title,sub,extra){return `<div class="head"><div><h1>${title}</h1><p>${sub}</p></div><div style="display:flex;gap:8px;flex-wrap:wrap">${extra||''}<button class="btn primary" data-act="new">${ICON.plus}Add task</button></div></div>`}
function emptyHTML(title,sub){return `<div class="empty"><b>${title}</b><span>${sub}</span><button class="btn primary sm" data-act="new">${ICON.plus}Add a task</button></div>`}
function miniRows(list,whenFn){return `<div class="mini">${list.map(t=>`<div class="mini-row ${t.done?'done':''}"><span class="ddot" style="background:${deptColor(deptOf(t))}"></span><span class="when ${whenFn?'':'mono'}">${whenFn?esc(whenFn(t)):fmtTime(t)}</span><span class="nm" data-edit="${t.id}">${esc(t.name)}<small>${esc(deptOf(t))}${isMulti(t)?' · '+esc(spanText(t)):''}${t.note?' · '+esc(t.note):''}</small></span>${priPill(t)}</div>`).join('')}</div>`}

/* ---------- dashboard ---------- */
function viewDashboard(){
  const now=new Date(), today=ymd(now), tmrw=ymd(addDays(now,1)), weekEnd=addDays(startOfDay(now),8);
  const open=tasks.filter(t=>!t.done).sort(sortByDue);
  const todays=tasks.filter(t=>t.due===today).sort(sortByDue);
  const ongoing=tasks.filter(t=>isMulti(t)&&spansDay(t,today)&&t.due!==today).sort(sortByDue);
  const tomorrows=tasks.filter(t=>spansDay(t,tmrw)).sort(sortByDue);
  const overdue=open.filter(isOver);
  const week=open.filter(t=>dueAt(t)>=now&&dueAt(t)<addDays(startOfDay(now),7));
  const doneWeek=tasks.filter(t=>t.done&&t.doneAt&&t.doneAt>addDays(now,-7).getTime());
  const next=open.find(t=>dueAt(t)>=now);
  const hr=now.getHours(), greet=hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  const notifs=computeNotifs().filter(n=>n.kind!=='upcoming').slice(0,3);
  const comingUp=open.filter(t=>t.due>tmrw&&dueAt(t)<weekEnd).slice(0,6);
  const important=open.filter(t=>t.priority==='urgent'||t.priority==='high').slice(0,5);

  const items=todays.map(t=>({at:dueAt(t),html:`<div class="slot ${t.done?'done':isOver(t)?'over':''}" style="--dc:${deptColor(deptOf(t))}"><span class="t">${fmtTime(t)}</span><span class="rail-dot"><i></i></span><div><div class="nm" data-edit="${t.id}">${esc(t.name)} ${priPill(t)}</div><div class="sub">${esc(deptOf(t))} · ${t.done?'Done':isOver(t)?'Overdue':untilText(dueAt(t)-now)}${t.note?' · '+esc(t.note):''}</div></div></div>`}))
    .concat(ongoing.map(t=>({at:startOfDay(now),html:`<div class="slot ${t.done?'done':''}" style="--dc:${deptColor(deptOf(t))}"><span class="t">${dayOfText(t,today).replace(' of ','/').replace('Day ','Day ')}</span><span class="rail-dot"><i></i></span><div><div class="nm" data-edit="${t.id}">${esc(t.name)} ${priPill(t)}</div><div class="sub">${esc(deptOf(t))} · ${dayOfText(t,today)} · due ${esc(fmtDue(t))}</div></div></div>`})))
    .concat(gOn(today).map(e=>({at:e.allDay?startOfDay(now):new Date(e.date+'T'+e.time+':00'),html:`<div class="slot gslot"><span class="t">${e.allDay?'All day':fmtTime(e)}</span><span class="rail-dot"><i></i></span><div><div class="nm"><a href="${esc(e.link)}" target="_blank" rel="noopener" data-glink>${esc(e.title)}</a></div><div class="sub">Google Calendar</div></div></div>`})))
    .sort((a,b)=>a.at-b.at);
  let agenda='';
  if(!items.length){agenda=`<p class="quiet">Nothing scheduled for today.</p>`}
  else{
    let placedNow=false;
    items.forEach(it=>{
      if(!placedNow&&it.at>now){agenda+=`<div class="nowline"><span>${now.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</span><hr></div>`;placedNow=true}
      agenda+=it.html;
    });
  }
  const gTmrw=gOn(tmrw).map(e=>`<div class="mini-row"><span class="ddot" style="background:transparent;border:2px solid var(--gcal);border-radius:50%"></span><span class="when mono">${e.allDay?'All day':fmtTime(e)}</span><span class="nm"><a href="${esc(e.link)}" target="_blank" rel="noopener" data-glink style="color:inherit;text-decoration:none">${esc(e.title)}</a><small>Google Calendar</small></span></div>`).join('');
  const deadlines=important.map(t=>{
    const days=Math.round((startOfDay(dueAt(t))-startOfDay(now))/864e5);
    const cls=isOver(t)?'past':days<=3?'near':'';
    const big=isOver(t)?'!':days===0?'0':days;
    const lbl=isOver(t)?'late':days===0?'today':days===1?'day':'days';
    return `<div class="dl ${cls}"><div class="days"><b class="mono" style="font-family:var(--f-display)">${big}</b><span>${lbl}</span></div><div class="nm" data-edit="${t.id}"><b>${esc(t.name)}</b><span>${esc(fmtDue(t))}</span></div>${priPill(t)}</div>`;
  }).join('');

  return `${headHTML(greet+', Preet',now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}
  <div class="stats">
    <div class="stat"><b class="mono">${todays.filter(t=>!t.done).length}</b><span>Left today</span></div>
    <div class="stat ${overdue.length?'alert':''}"><b class="mono">${overdue.length}</b><span>Overdue</span></div>
    <div class="stat"><b class="mono">${week.length}</b><span>Due in the next 7 days</span></div>
    <div class="stat good"><b class="mono">${doneWeek.length}</b><span>Finished this week</span></div>
  </div>
  <div class="dash">
    <div class="col">
      <section class="panel"><h2 class="eyebrow"><span>Today</span><a href="#tasks" data-goday="${today}">Open day</a></h2><div class="agenda">${agenda}</div></section>
      <section class="panel"><h2 class="eyebrow"><span>Tomorrow</span><a href="#tasks" data-goday="${tmrw}">Open day</a></h2>
        ${tomorrows.length||gTmrw?(tomorrows.length?miniRows(tomorrows,t=>t.due===tmrw?fmtTime(t):startOf(t)===tmrw?'Starts':dayOfText(t,tmrw)):'')+(gTmrw?`<div class="mini">${gTmrw}</div>`:''):'<p class="quiet">Nothing due tomorrow yet.</p>'}</section>
      <section class="panel"><h2 class="eyebrow"><span>Coming up · next 7 days</span><a href="#tasks" data-goview="week">Open week</a></h2>
        ${comingUp.length?miniRows(comingUp,t=>relDay(t.due)):'<p class="quiet">Nothing else due this week.</p>'}</section>
    </div>
    <div class="col">
      ${next?`<section class="next"><p class="eyebrow">Next up · ${esc(deptOf(next))}</p><h3 data-edit="${next.id}">${esc(next.name)}</h3><span class="when">${esc(fmtDue(next))}</span><span class="count">${untilText(dueAt(next)-now)}</span></section>`:`<section class="next"><p class="eyebrow">Next up</p><h3>You're all clear</h3><span class="when">Add a task to plan what's next.</span></section>`}
      <section class="panel"><h2 class="eyebrow"><span>Important deadlines</span><span>High &amp; urgent</span></h2>
        ${deadlines||'<p class="quiet">No high or urgent tasks open. Set a task’s priority to High or Urgent to track it here.</p>'}</section>
      <section class="panel"><h2 class="eyebrow"><span>Reminders</span><a href="#notifications">See all</a></h2>
        ${notifs.length?notifs.map(notifHTML).join(''):'<p class="quiet">No reminders right now. They show up here when a task gets close to its due time.</p>'}</section>
    </div>
  </div>`;
}

/* ---------- tasks: calendar ---------- */
function visibleTasks(){return tasks.filter(t=>deptFilter==='all'||deptOf(t)===deptFilter)}
function calTitle(){
  if(calView==='month')return calDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  if(calView==='week'){const s=addDays(calDate,-calDate.getDay()),e=addDays(s,6),mo=d=>d.toLocaleDateString(undefined,{month:'short'});return s.getMonth()===e.getMonth()?`${mo(s)} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}`:`${mo(s)} ${s.getDate()} – ${mo(e)} ${e.getDate()}, ${e.getFullYear()}`}
  if(calView==='day')return calDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  return 'By department';
}
function viewTasks(){
  const vt=visibleTasks();
  const counts={}; tasks.filter(t=>!t.done).forEach(t=>{counts[deptOf(t)]=(counts[deptOf(t)]||0)+1});
  const chips=`<div class="filters" role="group" aria-label="Filter by department"><button class="chip" data-dept="all" aria-pressed="${deptFilter==='all'}">All<span class="n">${tasks.filter(t=>!t.done).length}</span></button>${allDepts().map(d=>`<button class="chip" data-dept="${esc(d)}" aria-pressed="${deptFilter===d}"><span class="ddot" style="background:${deptColor(d)}"></span>${esc(d)}<span class="n">${counts[d]||0}</span></button>`).join('')}</div>`;
  const bar=`<div class="calbar">
    ${calView!=='list'?`<button class="btn sm" data-nav="today">Today</button><button class="icon-btn sm" data-nav="-1" aria-label="Previous">${ICON.left}</button><button class="icon-btn sm" data-nav="1" aria-label="Next">${ICON.right}</button>`:''}
    <h2>${esc(calTitle())}</h2>
    <div class="seg" role="group" aria-label="Calendar view">${['month','week','day','list'].map(v=>`<button data-view="${v}" aria-pressed="${calView===v}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}</div>
  </div>`;
  let body='';
  if(calView==='month')body=monthHTML(vt);
  else if(calView==='week')body=gridHTML(vt,7);
  else if(calView==='day')body=dayHTML(vt);
  else body=listHTML(vt);
  return `${headHTML('Tasks','Click a date to open it, or an empty spot to add a task there.',`<button class="btn" data-managedepts>Departments</button>`)}${bar}${chips}${body}`;
}
function laneUp(items){const lanes=[];items.forEach(b=>{let i=lanes.findIndex(end=>end<b.s);if(i<0){i=lanes.length;lanes.push(-1)}lanes[i]=b.e;b.lane=i});return lanes.length}
function spanBars(list,keys){
  const k0=keys[0], kN=keys[keys.length-1];
  return list.filter(t=>isMulti(t)&&startOf(t)<=kN&&t.due>=k0)
    .sort((a,b)=>startOf(a).localeCompare(startOf(b))||dayCount(b)-dayCount(a))
    .map(t=>({t,s:startOf(t)<k0?0:keys.indexOf(startOf(t)),e:t.due>kN?keys.length-1:keys.indexOf(t.due),cl:startOf(t)<k0,cr:t.due>kN}));
}
function barHTML(b,row,extra){
  const t=b.t;
  return `<button class="mbar ${b.cl?'cl':''} ${b.cr?'cr':''} ${t.done?'done':''}" style="grid-column:${b.s+1}/${b.e+2};grid-row:${row};--dc:${deptColor(deptOf(t))}${extra||''}" data-edit="${t.id}" title="${esc(t.name)} · ${esc(spanText(t))} · due ${esc(fmtDue(t))}"><span>${b.cl?'← ':''}${esc(t.name)}</span>${!b.cr&&t.time?`<em>due ${fmtShort(t)}</em>`:!b.cr?'<em>due</em>':''}</button>`;
}
function monthHTML(vt){
  const first=new Date(calDate.getFullYear(),calDate.getMonth(),1);
  const start=addDays(first,-first.getDay());
  const last=new Date(calDate.getFullYear(),calDate.getMonth()+1,0);
  const weeks=Math.ceil((first.getDay()+last.getDate())/7);
  const today=ymd(new Date()), MAXL=3;
  let html='';
  for(let w=0;w<weeks;w++){
    const ws=addDays(start,w*7), keys=[...Array(7)].map((_,i)=>ymd(addDays(ws,i)));
    const bars=spanBars(vt,keys), nl=laneUp(bars), shownL=Math.min(nl,MAXL);
    let cells='', tops='', lists='', barsHTML='';
    keys.forEach((key,i)=>{
      const d=addDays(ws,i);
      cells+=`<div class="mc ${d.getMonth()!==calDate.getMonth()?'out':''} ${key===today?'today':''}" style="grid-column:${i+1}" data-addday="${key}"></div>`;
      tops+=`<div class="mc-top" style="grid-column:${i+1}" data-addday="${key}"><button class="mc-num ${key===today?'is-today':''}" data-goday="${key}" aria-label="Open ${d.toDateString()}">${d.getDate()}</button></div>`;
      const tItems=vt.filter(t=>t.due===key&&!isMulti(t)).map(t=>({ad:!t.time,m:t.time?gMins(t.time):0,html:t.time
        ?`<button class="mc-ev ${t.done?'done':''}" data-edit="${t.id}"><span class="ddot" style="background:${deptColor(deptOf(t))}"></span><em>${fmtShort(t)}</em><span>${esc(t.name)}</span></button>`
        :`<button class="mc-ev allday ${t.done?'done':''}" style="--dc:${deptColor(deptOf(t))}" data-edit="${t.id}"><span>${esc(t.name)}</span></button>`}));
      const gItems=gOn(key).map(e=>({ad:e.allDay,m:e.allDay?0:gMins(e.time),html:e.allDay?gLink(e,'mc-ev allday',`<span>${esc(e.title)}</span>`):gLink(e,'mc-ev',`<span class="ddot"></span><em>${fmtShort(e)}</em><span>${esc(e.title)}</span>`)}));
      const singles=tItems.concat(gItems).sort((a,b)=>(b.ad-a.ad)||(a.m-b.m));
      const hiddenBars=bars.filter(b=>b.lane>=MAXL&&b.s<=i&&i<=b.e).length;
      const cap=Math.max(1,3-shownL), shown=singles.slice(0,cap), more=singles.length-shown.length+hiddenBars;
      lists+=`<div class="mc-list" style="grid-column:${i+1};grid-row:${shownL+2}" data-addday="${key}">${shown.map(x=>x.html).join('')}${more>0?`<button class="mc-more" data-goday="${key}">+${more} more</button>`:''}</div>`;
    });
    bars.filter(b=>b.lane<MAXL).forEach(b=>{barsHTML+=barHTML(b,b.lane+2)});
    html+=`<div class="mweek" style="grid-template-rows:auto${shownL?` repeat(${shownL},24px)`:''} 1fr">${cells}${tops}${barsHTML}${lists}</div>`;
  }
  return `<div class="month"><div class="mhead">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div>${x}</div>`).join('')}</div><div class="mweeks" id="mweeks">${html}</div></div>`;
}
function layoutDay(list,gl){
  const evs=list.filter(t=>t.time).map(t=>{const s=gMins(t.time);return {t,s,e:Math.min(s+60,1440)}})
    .concat((gl||[]).filter(e=>!e.allDay).map(g=>{const s=gMins(g.time);return {g,s,e:Math.max(Math.min(gMins(g.endTime||g.time),1440),s+20)}}))
    .sort((a,b)=>a.s-b.s);
  let cluster=[], end=-1;
  const flush=()=>{const lanes=[];cluster.forEach(ev=>{let i=lanes.findIndex(x=>x<=ev.s);if(i<0){i=lanes.length;lanes.push(0)}lanes[i]=ev.e;ev.lane=i});cluster.forEach(ev=>ev.lanes=lanes.length);cluster=[]};
  evs.forEach(ev=>{if(ev.s>=end&&cluster.length)flush();cluster.push(ev);end=Math.max(end,ev.e)});
  if(cluster.length)flush();
  return evs;
}
function gridHTML(vt,cols,startDate){
  const s=startDate||addDays(calDate,-calDate.getDay());
  const days=[...Array(cols)].map((_,i)=>addDays(s,i));
  const now=new Date(), today=ymd(now), H=48;
  const keys=days.map(ymd);
  let head=`<div class="tg-corner"></div>`, colsHTML='';
  const adBars=spanBars(vt,keys);
  const adSingles=[];
  keys.forEach((k,i)=>{
    vt.filter(t=>t.due===k&&!isMulti(t)&&!t.time).forEach(t=>adSingles.push({s:i,e:i,t}));
    gOn(k).filter(e=>e.allDay).forEach(e=>adSingles.push({s:i,e:i,g:e}));
  });
  const adAll=adBars.concat(adSingles), nAd=laneUp(adAll);
  const adCells=keys.map((k,i)=>`<div class="tg-adcell" style="grid-column:${i+1}"></div>`).join('');
  const adItems=adAll.map(b=>b.g?gLink(b.g,'mbar gbar',`<span>${esc(b.g.title)}</span>`).replace('class="mbar gbar g"',`class="mbar gbar g" style="grid-column:${b.s+1}/${b.e+2};grid-row:${b.lane+1}"`)
    :b.t&&!isMulti(b.t)?`<button class="mbar ${b.t.done?'done':''}" style="grid-column:${b.s+1};grid-row:${b.lane+1};--dc:${deptColor(deptOf(b.t))}" data-edit="${b.t.id}"><span>${esc(b.t.name)}</span></button>`
    :barHTML(b,b.lane+1)).join('');
  const ad=`<div class="tg-ad-label">all day</div><div class="tg-adrow" style="grid-column:span ${keys.length};grid-template-columns:repeat(${keys.length},minmax(0,1fr));grid-template-rows:repeat(${Math.max(1,nAd)},24px)">${adCells}${adItems}</div>`;
  days.forEach(d=>{
    const key=ymd(d), list=vt.filter(t=>t.due===key&&!isMulti(t));
    head+=`<div class="tg-h ${key===today?'today':''}"><span>${d.toLocaleDateString(undefined,{weekday:'short'})}</span><button data-goday="${key}" aria-label="Open ${d.toDateString()}">${d.getDate()}</button></div>`;
    const gl=gOn(key);
    const evs=layoutDay(list,gl);
    let inner=evs.map(ev=>{const w=100/ev.lanes;const pos=`top:${ev.s/60*H}px;height:${Math.max((ev.e-ev.s)/60*H-2,22)}px;left:calc(${ev.lane*w}% + 2px);width:calc(${w}% - 4px);right:auto`;
      if(ev.g)return `<a class="tg-ev g" style="${pos}" href="${esc(ev.g.link)}" target="_blank" rel="noopener" data-glink><b>${esc(ev.g.title)}</b><small>${fmtTime(ev.g)} · Google</small></a>`;
      return `<button class="tg-ev ${ev.t.done?'done':''}" style="--dc:${deptColor(deptOf(ev.t))};${pos}" data-edit="${ev.t.id}"><b>${esc(ev.t.name)}</b><small>${fmtTime(ev.t)} · ${esc(deptOf(ev.t))}</small></button>`}).join('');
    if(key===today)inner+=`<div class="tg-now" style="top:${(now.getHours()*60+now.getMinutes())/60*H}px"></div>`;
    colsHTML+=`<div class="tg-col ${key===today?'today':''}" data-slotday="${key}">${inner}</div>`;
  });
  const gut=`<div class="tg-gut">${[...Array(24)].map((_,h)=>`<div>${h===0?'':((h%12)||12)+(h<12?' AM':' PM')}</div>`).join('')}</div>`;
  return `<div class="tg-wrap"><div class="tg-scroll" id="tgScroll"><div class="tg" style="--cols:${cols};--minw:${cols>1?'760px':'0'}">${head}${ad}${gut}${colsHTML}</div></div></div>`;
}
function dayHTML(vt){
  const key=ymd(calDate), list=vt.filter(t=>spansDay(t,key)).sort((a,b)=>(isMulti(b)-isMulti(a))||sortByDue(a,b));
  return `<div class="dayview">${gridHTML(vt,1,calDate)}
    <section class="panel"><h2 class="eyebrow"><span>${esc(relDay(key))}</span><span>${list.length} task${list.length===1?'':'s'}</span></h2>
      ${list.length?list.map(t=>`<div class="mini-row ${t.done?'done':''}"><span class="ddot" style="background:${deptColor(deptOf(t))}"></span><span class="when mono">${isMulti(t)&&t.due!==key?esc(dayOfText(t,key)):fmtTime(t)}</span><span class="nm" data-edit="${t.id}">${esc(t.name)}<small>${esc(deptOf(t))}${isMulti(t)?' · '+esc(spanText(t))+' · due '+esc(fmtDue(t)):''}${t.note?' · '+esc(t.note):''}</small></span><button class="icon-btn sm ${t.done?'':'ok'}" data-done="${t.id}" aria-label="${t.done?'Mark not done':'Mark done'}">${t.done?ICON.undo:ICON.check}</button></div>`).join(''):'<p class="quiet">Nothing on this day. Click a time on the left to add a task at that hour.</p>'}
      ${gOn(key).map(e=>`<div class="mini-row"><span class="ddot" style="background:transparent;border:2px solid var(--gcal);border-radius:50%"></span><span class="when mono">${e.allDay?'All day':fmtTime(e)}</span><span class="nm"><a href="${esc(e.link)}" target="_blank" rel="noopener" data-glink style="color:inherit;text-decoration:none">${esc(e.title)}</a><small>Google Calendar</small></span></div>`).join('')}
      <button class="btn sm" data-addday="${key}" style="align-self:flex-start">${ICON.plus}Add to this day</button>
    </section></div>`;
}
function gtag(t){if(!google.connected)return '';if(t.gcalErr)return `<span class="gtag err" title="${esc(t.gcalErr)}">Not in Google Calendar</span>`;return t.gcalId?`<span class="gtag">${ICON.google}In Google Calendar</span>`:''}
function taskCard(t){
  const now=new Date(), over=isOver(t);
  const tk=ymd(now), inProg=isMulti(t)&&spansDay(t,tk)&&t.due!==tk;
  const state=t.done?'<span class="pill done">Done</span>':over?'<span class="pill over">Overdue</span>':inProg?'<span class="pill when">'+esc(dayOfText(t,tk))+'</span>':(isMulti(t)&&startOf(t)>tk)?'<span class="pill when">Starts '+esc(relDay(startOf(t)))+'</span>':'<span class="pill when">'+esc(relDay(t.due))+'</span>';
  return `<article class="card ${t.done?'is-done':''}" style="--dc:${deptColor(deptOf(t))}">
    <div class="info"><div class="top"><b>${esc(t.name)}</b>${state}${priPill(t)}${dtag(t)}${gtag(t)}</div>
      ${t.note?`<div class="note">${esc(t.note)}</div>`:''}
      <div class="meta">${isMulti(t)?`Start: <strong>${esc(shortDate(startOf(t)))}</strong> · End: <strong>${esc(parseDay(t.due).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}))}</strong> (${dayCount(t)} days)`:`Due: <strong>${esc(parseDay(t.due).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}))}</strong>`} · Time: <strong class="mono">${fmtTime(t)}</strong>${!t.done?' · '+untilText(dueAt(t)-now):''}</div></div>
    <div class="acts">
      ${!t.done?`<button class="btn sm" data-tmrw="${t.id}">${ICON.cal}Tomorrow</button>`:''}
      <button class="icon-btn" data-edit="${t.id}" aria-label="Edit ${esc(t.name)}">${ICON.edit}</button>
      <button class="icon-btn ${t.done?'':'ok'}" data-done="${t.id}" aria-label="${t.done?'Mark not done':'Mark done'}">${t.done?ICON.undo:ICON.check}</button>
      <button class="icon-btn del" data-del="${t.id}" aria-label="Delete ${esc(t.name)}">${ICON.trash}</button>
    </div></article>`;
}
function listHTML(vt){
  const list=vt.filter(t=>showDone||!t.done);
  const toggle=`<div><button class="chip" data-showdone aria-pressed="${showDone}">Show finished tasks</button></div>`;
  if(!list.length)return toggle+emptyHTML('No tasks here','Tasks you add are grouped here by department.');
  const groups={}; list.forEach(t=>{(groups[deptOf(t)]=groups[deptOf(t)]||[]).push(t)});
  const order=allDepts().filter(d=>groups[d]);
  return toggle+order.map(d=>`<section class="dgroup"><h3><span class="ddot" style="background:${deptColor(d)}"></span>${esc(d)}<small>${groups[d].length}</small></h3><div class="list">${groups[d].sort((a,b)=>(a.done-b.done)||sortByDue(a,b)).map(taskCard).join('')}</div></section>`).join('');
}

/* ---------- notifications ---------- */
function notifHTML(n){
  const t=n.t, ico=n.kind==='overdue'?ICON.alert:n.kind==='soon'?ICON.clock:ICON.bell;
  const head={overdue:'Overdue',soon:'Due soon',today:'Due today',starts:'Starts today',upcoming:'Coming up'}[n.kind];
  const sub=n.kind==='starts'?'Starts today · '+spanText(t)+' · due '+fmtDue(t):n.kind==='overdue'?'Was due '+fmtDue(t).toLowerCase()+' · '+untilText(n.ms):head+' · '+fmtDue(t)+' · '+untilText(n.ms);
  return `<div class="notif ${n.kind}"><span class="ico">${ico}</span><div class="txt"><b>${esc(t.name)}</b><span>${esc(deptOf(t))} · ${esc(sub)}</span></div>
    <div class="acts"><button class="btn sm" data-done="${t.id}">${ICON.check}Done</button>${n.kind!=='upcoming'?`<button class="btn sm" data-snooze="${t.id}">Snooze 1 hr</button>`:''}<button class="btn sm" data-dismiss="${esc(n.key)}">Dismiss</button></div></div>`;
}
function viewNotifications(){
  const n=computeNotifs();
  const g=k=>n.filter(x=>x.kind===k);
  const sec=(title,items)=>items.length?`<section class="ngroup"><h2 class="eyebrow"><span>${title}</span><span>${items.length}</span></h2>${items.map(notifHTML).join('')}</section>`:'';
  const body=sec('Overdue',g('overdue'))+sec('Due soon',g('soon'))+sec('Starting today',g('starts'))+sec('Later today',g('today'))+sec('Tomorrow and soon after',g('upcoming'));
  return `${headHTML('Notifications','Reminders follow each task’s “Remind me” setting while this page is open.')}
  ${body||`<div class="empty"><b>You're all caught up</b><span>When a task gets close to its due time, a reminder shows up here and pops up in the corner.</span></div>`}`;
}

/* ---------- render ---------- */
function renderRail(){
  const gs=document.getElementById('gStatus');
  gs.innerHTML=google.connected?`<span class="dot g"></span><span>Google Calendar connected</span>`:`<span class="dot"></span><button class="linkbtn" data-opensettings>Connect Google Calendar</button>`;
  const counts={}; tasks.filter(t=>!t.done).forEach(t=>{counts[deptOf(t)]=(counts[deptOf(t)]||0)+1});
  document.getElementById('deptRail').innerHTML=`<p class="eyebrow"><span>Departments</span><button class="linkbtn" data-managedepts>Manage</button></p>`+allDepts().map(d=>`<div><span class="ddot" style="background:${deptColor(d)}"></span><span>${esc(d)}</span><span>${counts[d]||0}</span></div>`).join('');
}
let lastGridKey='';
function renderAll(){
  const old=document.getElementById('tgScroll'), oldTop=old?old.scrollTop:null;
  const v=document.getElementById('view');
  const map={dashboard:viewDashboard,tasks:viewTasks,notifications:viewNotifications};
  v.innerHTML=(map[page]||viewDashboard)();
  document.querySelectorAll('.nav a').forEach(a=>a.setAttribute('aria-current',a.dataset.page===page?'page':'false'));
  document.getElementById('railDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
  renderRail();
  const sc=document.getElementById('tgScroll');
  if(sc){const key=page+calView+ymd(calDate);sc.scrollTop=(oldTop!==null&&key===lastGridKey)?oldTop:7*48;lastGridKey=key}
  checkReminders();
  loadGEvents();
}
function goDay(key){calDate=parseDay(key);calView='day';lsSet(LS_VIEW,calView);if(location.hash!=='#tasks'){page='tasks';location.hash='#tasks'}renderAll()}

document.getElementById('view').addEventListener('click',e=>{
  const b=e.target.closest('[data-act],[data-edit],[data-done],[data-del],[data-tmrw],[data-dept],[data-view],[data-nav],[data-goday],[data-goview],[data-addday],[data-slotday],[data-snooze],[data-dismiss],[data-showdone],[data-managedepts],[data-glink]');
  if(!b)return; const d=b.dataset;
  if(d.glink!==undefined)return;
  if(d.act==='new')openForm();
  else if(d.edit)openForm(tasks.find(t=>t.id===d.edit));
  else if(d.done)toggleDone(d.done);
  else if(d.del)removeTask(d.del);
  else if(d.tmrw)moveTomorrow(d.tmrw);
  else if(d.dept){deptFilter=d.dept;renderAll()}
  else if(d.view){calView=d.view;lsSet(LS_VIEW,calView);renderAll()}
  else if(d.nav){
    if(d.nav==='today')calDate=startOfDay(new Date());
    else{const n=Number(d.nav);if(calView==='month')calDate=new Date(calDate.getFullYear(),calDate.getMonth()+n,1);else calDate=addDays(calDate,calView==='week'?7*n:n)}
    renderAll();
  }
  else if(d.goday!==undefined){e.preventDefault();goDay(d.goday)}
  else if(d.goview){e.preventDefault();calView=d.goview;calDate=startOfDay(new Date());lsSet(LS_VIEW,calView);page='tasks';location.hash='#tasks';renderAll()}
  else if(d.slotday){
    const r=b.getBoundingClientRect(), mins=Math.max(0,Math.min(1410,Math.floor((e.clientY-r.top)/48*2)*30));
    openForm(null,{due:d.slotday,time:pad(Math.floor(mins/60))+':'+pad(mins%60)});
  }
  else if(d.addday)openForm(null,{due:d.addday});
  else if(d.snooze){patch(d.snooze,{snoozeUntil:Date.now()+36e5});toast('Snoozed for 1 hour')}
  else if(d.dismiss)dismiss(d.dismiss);
  else if(d.showdone!==undefined){showDone=!showDone;renderAll()}
  else if(d.managedepts!==undefined)openDepts();
});
document.getElementById('deptRail').addEventListener('click',e=>{if(e.target.closest('[data-managedepts]'))openDepts()});
document.getElementById('gStatus').addEventListener('click',e=>{if(e.target.closest('[data-opensettings]'))openSettings()});
/* ---------- settings ---------- */
function openSettings(){
  const host=document.getElementById('modalHost');
  const close=()=>{host.innerHTML='';history.replaceState(null,'','#'+page)};
  const draw=()=>{
    const g=google;
    const notifState=!('Notification' in window)?'unsupported':Notification.permission;
    let gHTML='';
    if(!g.curl)gHTML+=`<p class="banner bad">Your server doesn’t have PHP cURL turned on, which Google sync needs. In cPanel, open “Select PHP Version” → Extensions and turn on curl.</p>`;
    if(g.error)gHTML+=`<p class="banner bad">${esc(g.error)}</p>`;
    if(!g.configured){
      gHTML+=`<p>One-time setup in Google Cloud (full steps are in the README):</p>
        <ol><li>Create a project and enable the <b>Google Calendar API</b>.</li>
        <li>Set up the OAuth consent screen, add your Gmail as a test user, then publish it.</li>
        <li>Create an OAuth client ID of type <b>Web application</b> with this redirect URI:</li></ol>
        <div class="copyrow"><code id="redir">${esc(g.redirectUri)}</code><button class="btn sm" id="copyRedir">Copy</button></div>
        <div class="field"><label for="gcId">Client ID</label><input id="gcId" autocomplete="off" spellcheck="false" placeholder="….apps.googleusercontent.com"></div>
        <div class="field"><label for="gcSecret">Client secret</label><input id="gcSecret" type="password" autocomplete="off" spellcheck="false"></div>
        <div class="btnrow"><button class="btn primary" id="gSave">Save keys</button></div>`;
    }else if(!g.connected){
      gHTML+=`<p>Keys saved (${esc(g.clientIdHint)}). Sign in with Google to let My Calendar add your tasks to your calendar.</p>
        <div class="btnrow"><a class="btn primary" href="./?action=gauth">Connect Google Calendar</a><button class="btn" id="gForget">Use different keys</button></div>`;
    }else{
      gHTML+=`<p class="okline">${ICON.check.replace('<svg','<svg width="18" height="18"')}Connected to your primary Google Calendar</p>
        <p>Every task you add, change, finish or delete is updated there with its reminder. Your Google events also show in your calendar views.</p>
        <p>For alerts, allow notifications in the Google Calendar app on your phone, and on your laptop turn on desktop notifications in Google Calendar’s settings.</p>
        <div class="btnrow"><button class="btn" id="gSyncAll">Sync all tasks now</button><button class="btn" id="gDisc">Disconnect</button></div>`;
    }
    host.innerHTML=`<div class="scrim" id="scrim"><div class="modal wide" role="dialog" aria-label="Settings">
      <h2>Settings</h2>
      <section class="setsec"><h3>Google Calendar</h3>${gHTML}</section>
      <section class="setsec"><h3>Alerts on this device</h3>
        <p>Shows a system notification when a reminder is due while My Calendar is open. Google Calendar alerts work even when it’s closed.</p>
        ${notifState==='granted'?'<p class="okline">Alerts are on for this browser.</p>':notifState==='denied'?'<p>Alerts are blocked. Allow notifications for this site in your browser’s site settings.</p>':notifState==='unsupported'?'<p>This browser doesn’t support alerts.</p>':'<div class="btnrow"><button class="btn" id="nOn">Turn on alerts</button></div>'}
      </section>
      <section class="setsec"><h3>Password</h3>
        <div class="row2"><div class="field"><label for="pwCur">Current password</label><input id="pwCur" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pwNew">New password</label><input id="pwNew" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div></div>
        <div class="btnrow"><button class="btn" id="pwSave">Change password</button></div>
      </section>
      <p class="err" id="sErr" hidden></p>
      <div class="mfoot"><button class="btn spacer" id="signOut">Sign out</button><button class="btn primary" id="sClose">Done</button></div>
    </div></div>`;
    const err=document.getElementById('sErr');
    const fail=e=>{err.textContent=e.message||String(e);err.hidden=false};
    const $=id=>document.getElementById(id);
    $('scrim').addEventListener('mousedown',e=>{if(e.target.id==='scrim')close()});
    $('sClose').onclick=close;
    $('signOut').onclick=()=>document.getElementById('logoutForm').submit();
    if($('copyRedir'))$('copyRedir').onclick=()=>{navigator.clipboard.writeText(g.redirectUri).then(()=>toast('Copied the redirect URI'),()=>{const r=document.createRange();r.selectNodeContents($('redir'));const s=getSelection();s.removeAllRanges();s.addRange(r)})};
    if($('gSave'))$('gSave').onclick=async()=>{try{const j=await api('settings',{clientId:$('gcId').value,clientSecret:$('gcSecret').value});google=j.google;toast('Keys saved');draw()}catch(e){fail(e)}};
    if($('gForget'))$('gForget').onclick=async()=>{try{const j=await api('settings',{forgetKeys:true});google=j.google;draw()}catch(e){fail(e)}};
    if($('gDisc'))$('gDisc').onclick=async()=>{try{const j=await api('settings',{disconnect:true});google=j.google;gEvents=[];toast('Google Calendar disconnected');renderAll();draw()}catch(e){fail(e)}};
    if($('gSyncAll'))$('gSyncAll').onclick=async e=>{e.target.disabled=true;e.target.textContent='Syncing…';try{const j=await api('gsyncall',{});toast(j.gcalErrors?`Synced, but ${j.gcalErrors} task${j.gcalErrors===1?'':'s'} failed`:`Synced ${j.count} task${j.count===1?'':'s'} to Google Calendar`);await pull(true)}catch(x){fail(x)}draw()};
    if($('nOn'))$('nOn').onclick=async()=>{try{await Notification.requestPermission()}catch(e){}draw();if(Notification.permission==='granted')sysNotify('Alerts are on','You’ll see reminders here while My Calendar is open.','mycal-test')};
    $('pwSave').onclick=async()=>{try{await api('change',{current:$('pwCur').value,new:$('pwNew').value});$('pwCur').value='';$('pwNew').value='';toast('Password changed. Other devices will need to sign in again.')}catch(e){fail(e)}};
  };
  draw();
}

/* drag across days in month view to make a multi-day task */
(function(){
  let from=null, to=null, dragging=false, suppress=false;
  const keyAt=(x,y)=>{const el=document.elementFromPoint(x,y);const c=el&&el.closest('.mweeks [data-addday]');return c?c.dataset.addday:null};
  const paint=()=>{const a=from<to?from:to,b=from<to?to:from;document.querySelectorAll('.mweeks .mc').forEach(c=>c.classList.toggle('sel',dragging&&c.dataset.addday>=a&&c.dataset.addday<=b))};
  document.addEventListener('pointerdown',e=>{if(e.button!==0||e.pointerType==='touch')return;if(e.target.closest('button,a'))return;const k=keyAt(e.clientX,e.clientY);if(!k)return;from=to=k;dragging=false});
  document.addEventListener('pointermove',e=>{if(!from)return;const k=keyAt(e.clientX,e.clientY);if(k&&k!==to){to=k;dragging=from!==to;paint()}});
  document.addEventListener('pointerup',()=>{if(!from)return;if(dragging){const a=from<to?from:to,b=from<to?to:from;suppress=true;setTimeout(()=>{suppress=false},50);openForm(null,{start:a,due:b})}from=to=null;dragging=false;paint()});
  document.addEventListener('click',e=>{if(suppress){e.stopPropagation();e.preventDefault();suppress=false}},true);
})();

function route(){
  let h=(location.hash||'').slice(1);
  if(h==='settings'){if(page==null)page='dashboard';renderAll();openSettings();return}
  if(h==='schedule'){h='tasks';calView='week'}
  page=['dashboard','tasks','notifications'].includes(h)?h:'dashboard';renderAll();window.scrollTo(0,0)
}
window.addEventListener('hashchange',route);

/* ---------- start ---------- */
(function handleGoogleReturn(){
  const q=new URLSearchParams(location.search), gc=q.get('gc');
  if(!gc)return;
  history.replaceState(null,'',location.pathname+'#settings');
  setTimeout(()=>{
    if(gc==='ok'){toast('Google Calendar connected. Syncing your tasks…');api('gsyncall',{}).then(j=>{toast(`Added ${j.count} task${j.count===1?'':'s'} to Google Calendar`);pull(true)}).catch(()=>{})}
    else if(gc==='nokeys')toast('Save your Google keys first.');
    else toast('Google didn’t finish connecting. Try Connect again.');
  },300);
})();
route();
pull(true).then(()=>{
  const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
  if(tz&&tz!==google.tz)api('settings',{tz}).then(j=>{google=j.google}).catch(()=>{});
  loadGEvents(true);
});
setInterval(()=>{if(document.visibilityState==='visible')pull(false)},8000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){pull(false);loadGEvents()}});
setInterval(()=>{if(!document.getElementById('modalHost').innerHTML)renderAll();else checkReminders()},30000);
setInterval(()=>loadGEvents(true),300000);
})();
