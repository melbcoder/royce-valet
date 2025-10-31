import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { subscribeVehicleByTag, requestVehicle, cancelRequest, scheduleRequest, clearSchedule } from '../services/valetFirestore'
const StatusBadge = ({status}) => {
  const cls = status==='Ready' ? 'status-ready' : (status==='Retrieving' ? 'status-retrieving' : (status==='Out' ? 'status-out' : 'status-parked'))
  const prettyStatus = status.charAt(0).toUpperCase() + status.slice(1)
  const label = status === 'out' ? 'Out & About' : prettyStatus
  return <span className={'status-pill '+cls}>{label}</span>
}
export default function Guest(){
  const { tag } = useParams()
  const [v, setV] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)
  useEffect(()=>{
    const unsub = subscribeVehicleByTag(tag, (doc)=>{ setV(doc); setLoaded(true) })
    return ()=> unsub && unsub()
  }, [tag])
  if(!loaded){ return <section className="card pad"><p>Loading…</p></section> }
  if(!v){ return <section className="card pad"><h1>Valet Link</h1><p>We couldn't find details for tag <strong>{tag}</strong>. Please check with the concierge.</p></section> }
  async function onRequest(){
    if(sending) return
    setSending(true)
    try { await requestVehicle(v.tag) } catch(e){ alert(e?.message || 'Unable to request right now.') } finally { setSending(false) }
  }
  async function onCancel(){
    if(sending) return
    setSending(true)
    try { await cancelRequest(v.tag) } finally { setSending(false) }
  }
  async function onSchedule(){
    const el = document.getElementById('sched')
    if(!el || !el.value) return
    const when = new Date(el.value)
    if(isNaN(+when)){ alert('Please choose a valid date and time.'); return }
    if(when.getTime() - Date.now() < 10*60*1000){ alert('Please schedule at least 10 minutes in advance.'); return }
    await scheduleRequest(v.tag, when.toISOString())
    alert('Pickup scheduled. We will move your request into the queue ~10 minutes prior.')
  }
  const canRequest = v.status !== 'Out'
  return (
    <section className="card pad">
      <h1>Your Vehicle</h1>
      <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
        <div className="tag">Tag #{v.tag}</div>
        <StatusBadge status={v.status} />
      </div>
      {v.status==='out' && (<p style={{marginTop:6}}><strong>Your vehicle is out &amp; about. Enjoy your drive!</strong></p>)}
      <div className="grid cols-2">
        <div className="field"><label>Guest</label><div>{v.guestName} (Room {v.roomNumber})</div></div>
        <div className="field"><label>Plate</label><div>{v.plate || '—'}</div></div>
        <div className="field"><label>Vehicle</label><div>{[v.colour, v.make, v.model].filter(x=>!!(x||'').trim()).join(' ') || '—'}</div></div>
        <div className="field"><label>Schedule a pickup time</label>
          <div className="row">
            <input type="datetime-local" id="sched" defaultValue="" />
            <button className="btn" onClick={onSchedule}>Schedule</button>
            {v.scheduledAt && <button className="btn secondary" onClick={async()=>{ await clearSchedule(v.tag) }}>Clear</button>}
          </div>
          {v.scheduledAt && <small>Scheduled for: {new Date(v.scheduledAt).toLocaleString()}</small>}
        </div>
      </div>
      <div className="row" style={{marginTop:18}}>
        {canRequest && !v.requested && !sending && (
          <button className="btn btn-dark" onClick={onRequest}>Request My Vehicle</button>
        )}
        {v.requested && v.status!=='Out' && <button className="btn secondary" disabled={sending} onClick={onCancel}>Cancel Request</button>}
      </div>
      <p style={{marginTop:14, color:'var(--muted)'}}>We’ll update your status here when the valet is retrieving or ready.</p>
    </section>
  )
}