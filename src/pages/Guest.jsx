import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { subscribeVehicleByTag, requestVehicle, cancelRequest, scheduleRequest, clearSchedule } from '../services/valetFirestore'

const StatusBadge = ({ status }) => {
  const s = String(status || '').toLowerCase() || 'parked'
  const label = s === 'out' ? 'Out & About' : (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
  return <span className={`status-pill status-${s}`}>{label}</span>
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

  // normalized status to make rendering/guards consistent
  const status = String(v?.status || '').toLowerCase()

  async function onRequest(){
    if(sending) return
    if (String(v?.status || '').toLowerCase() === 'out') { alert('Vehicle is out and cannot be requested.'); return }
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

  const canRequest = status !== 'out'
  const isDeparted = status === 'departed'

  return (
    <section className="card pad">
      <h1>Your Vehicle</h1>
      <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
        <div className="tag">Tag #{v.tag}</div>
        <StatusBadge status={v.status} />
      </div>

      {status === 'out' && (<p style={{marginTop:6}}><strong>Your vehicle is out &amp; about. Enjoy your drive!</strong></p>)}

      {isDeparted && (
        <div style={{ 
          background: '#f8f9fa', 
          padding: '16px', 
          borderRadius: '8px', 
          marginBottom: '16px',
          border: '1px solid #e0e0e0'
        }}>
          <p style={{ fontSize: '1.1em', lineHeight: '1.6', margin: 0 }}>
            Thank you for staying at The Royce. We hope you enjoyed your visit and look forward to welcoming you back in the near future.
          </p>
          <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--muted)' }}>
            Safe travels!
          </p>
        </div>
      )}

      <div className="grid cols-2">
        <div className="field"><label>Guest</label><div>{v.guestName}</div></div>
        <div className="field"><label>Room Number</label><div>{v.roomNumber}</div></div>
        <div className="field"><label>Plate</label><div>{v.license || '—'}</div></div>
        <div className="field"><label>Vehicle</label><div>{[v.colour, v.make, v.model].filter(x=>!!(x||'').trim()).join(' ') || '—'}</div></div>
        
        {!isDeparted && (
          <div className="field"><label>Schedule a pickup time</label>
            <div className="row">
              <input type="datetime-local" id="sched" defaultValue="" />
              <button className="btn secondary" onClick={onSchedule}>Schedule</button>
              {v.scheduledAt && <button className="btn secondary" onClick={async()=>{ await clearSchedule(v.tag) }}>Clear</button>}
            </div>
            {v.scheduledAt && <small>Scheduled for: {new Date(v.scheduledAt).toLocaleString()}</small>}
          </div>
        )}
      </div>

      {!isDeparted && (
        <>
          <div className="row" style={{marginTop:18}}>
            {canRequest && !v.requested && !sending && (
              <button className="btn btn-dark" onClick={onRequest}>Request My Vehicle</button>
            )}
            {v.requested && status !== 'out' && (
              <button className="btn secondary" disabled={sending} onClick={onCancel}>Cancel Request</button>
            )}
          </div>

          <p style={{marginTop:14, color:'var(--muted)'}}>We'll update your status here when the valet is retrieving or ready.</p>
        </>
      )}
    </section>
  )
}