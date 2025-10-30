const KEY = 'royce-valet-demo-v11'
const HIST = 'royce-valet-history'

function read(){ try{ return JSON.parse(localStorage.getItem(KEY) || '[]') }catch{ return [] } }
function write(list){ localStorage.setItem(KEY, JSON.stringify(list)) }
function readHist(){ try{ return JSON.parse(localStorage.getItem(HIST) || '[]') }catch{ return [] } }
function writeHist(list){ localStorage.setItem(HIST, JSON.stringify(list)) }

const subs = new Set()
function notify(){ const data = read(); subs.forEach(f=>f(data)) }
window.addEventListener('storage', (e)=>{ if(e.key===KEY) notify() })

export function subscribeVehicles(cb){ subs.add(cb); cb(read()); return ()=>subs.delete(cb) }
export function subscribeVehicleByTag(tag, cb){ const h=(l)=>cb(l.find(v=>String(v.tag)===String(tag))||null); subs.add(h); h(read()); return ()=>subs.delete(h) }

function upsert(v){ const l=read(); const i=l.findIndex(x=>String(x.tag)===String(v.tag)); if(i>=0) l[i]=v; else l.push(v); write(l); notify() }
function removeByTag(tag){ const l=read().filter(v => String(v.tag)!==String(tag)); write(l); notify() }
function findByTag(tag){ return read().find(v => String(v.tag)===String(tag)) }

function pushEvent(v, type, payload={}){ v.events=v.events||[]; v.events.push({ type, ts:new Date().toISOString(), ...payload }) }

export async function createVehicle(v){
  const rec = { tag:String(v.tag).trim(), guestName:v.guestName||'', roomNumber:v.roomNumber||'', mobile:v.mobile||'',
    plate:v.plate||'', make:v.make||'', model:v.model||'', colour:v.colour||'', bay:v.bay||'',
    departureDate:v.departureDate||'', status:'Received', requested:false, ack:false, requestedAt:null, scheduledAt:null, scheduledNote:'',
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), events:[], notes:v.notes||'' }
  pushEvent(rec,'created',{by:'staff'}); upsert(rec); return rec.tag
}

export async function setVehicleStatus(tag, status){
  const v = findByTag(tag); if(!v) return
  v.status=status; v.updatedAt=new Date().toISOString(); pushEvent(v,'status',{status}); upsert(v)
}

export async function parkVehicle(tag, { bay, make, model, colour, plate }){
  const v = findByTag(tag); if(!v) return
  if(!bay || String(bay).trim()==='') throw new Error('Bay is required')
  if(!plate || String(plate).trim()==='') throw new Error('Plate is required')
  v.bay=String(bay).trim(); v.plate=String(plate).trim()
  if(make!==undefined) v.make=make; if(model!==undefined) v.model=model; if(colour!==undefined) v.colour=colour
  v.status='Parked'; v.updatedAt=new Date().toISOString(); pushEvent(v,'parked',{bay:v.bay}); upsert(v)
}

export async function requestVehicle(tag){
  const v = findByTag(tag); if(!v) return
  if(v.status==='Out'){ throw new Error('Vehicle is already out & about.') }
  v.requested=true; v.ack=false; v.requestedAt=new Date().toISOString(); v.scheduledAt=null; // remove from schedule when requested
  pushEvent(v,'requested'); upsert(v)
}

export async function cancelRequest(tag){
  const v = findByTag(tag); if(!v) return
  if(v.status==='Out'){ return }
  v.requested=false; v.ack=false; pushEvent(v,'request_cancelled'); upsert(v)
}

export async function acknowledgeRequest(tag){
  const v = findByTag(tag); if(!v) return
  v.requested=true; v.ack=true; v.status='Retrieving'; v.updatedAt=new Date().toISOString()
  pushEvent(v,'request_acknowledged'); pushEvent(v,'status',{status:'Retrieving'}); upsert(v)
}

export async function markReady(tag){
  const v = findByTag(tag); if(!v) return
  v.requested=true; v.ack=true; v.status='Ready'; v.updatedAt=new Date().toISOString()
  pushEvent(v,'status',{status:'Ready'}); upsert(v)
}

export async function markOut(tag){
  const v = findByTag(tag); if(!v) return
  v.requested=false; v.ack=false; v.status='Out'; v.handedOverAt=new Date().toISOString(); v.updatedAt=new Date().toISOString()
  pushEvent(v,'status',{status:'Out'}); pushEvent(v,'handed_over'); upsert(v)
}

export function moveToHistory(tag){
  const v = findByTag(tag); if(!v) return null
  const hist = readHist()
  const copy = { ...v, departedAt: new Date().toISOString() }
  writeHist([copy, ...hist])
  removeByTag(tag)
  return copy
}

export function restoreFromHistory(entry){
  const hist = readHist().filter(x => String(x.tag)!==String(entry.tag))
  writeHist(hist)
  const revived = { ...entry }
  delete revived.departedAt
  if(revived.status==='Out'){ revived.requested=false }
  upsert(revived)
}

export async function scheduleRequest(tag, whenISO, note=''){
  const v = findByTag(tag); if(!v) return
  v.scheduledAt = whenISO; v.scheduledNote = note || ''
  pushEvent(v, 'scheduled', { at: whenISO })
  upsert(v)
}
export async function clearSchedule(tag){
  const v = findByTag(tag); if(!v) return
  v.scheduledAt = null; v.scheduledNote = ''
  pushEvent(v, 'schedule_cleared')
  upsert(v)
}

export function updateDepartureDate(tag, newDate){
  const v = findByTag(tag); if(!v) return
  v.departureDate = newDate
  v.updatedAt = new Date().toISOString()
  upsert(v)
}