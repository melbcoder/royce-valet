import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const StatusBadge = ({ status }) => {
  const s = String(status || '').toLowerCase() || 'parked'
  const label = s === 'out' ? 'Out & About' : (s === 'departed' ? 'Departed' : (s ? s.charAt(0).toUpperCase() + s.slice(1) : ''))
  return <span className={`status-pill status-${s}`}>{label}</span>
}

export default function Guest(){
  const { accessToken } = useParams()
  const [v, setV] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const loadVehicle = async (token) => {
    const res = await fetch(`/api/guest-vehicle?t=${encodeURIComponent(token)}`)
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw new Error(data?.error || 'Unable to load guest access')
    }

    return data.vehicle || null
  }

  const postGuestAction = async (action, extra = {}) => {
    const res = await fetch('/api/guest-vehicle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken, action, ...extra }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw new Error(data?.error || 'Unable to update vehicle')
    }

    if (data.vehicle) setV(data.vehicle)
    return data.vehicle
  }

  // Validate guest token parameter
  useEffect(() => {
    if (accessToken && !/^[a-f0-9]{64}$/.test(accessToken)) {
      setError('This guest link is invalid. Please request a fresh link from valet.')
      setLoaded(true);
      return;
    }
  }, [accessToken]);

  useEffect(()=>{
    if (!accessToken || !/^[a-f0-9]{64}$/.test(accessToken)) return;

    let active = true

    const refresh = async () => {
      try {
        const vehicle = await loadVehicle(accessToken)
        if (!active) return
        setV(vehicle)
        setError('')
      } catch (err) {
        if (!active) return
        setV(null)
        setError(err?.message || 'Unable to load guest access')
      } finally {
        if (active) setLoaded(true)
      }
    }

    refresh()
    const interval = setInterval(refresh, 10000)
    return ()=> {
      active = false
      clearInterval(interval)
    }
  }, [accessToken])

  if(!loaded){ return <section className="card pad"><p>Loading…</p></section> }
  
  if (!accessToken || !/^[a-f0-9]{64}$/.test(accessToken)) {
    return (
      <section className="card pad">
        <h1>Valet Link</h1>
        <p>{error || 'Invalid guest link. Please check with the concierge.'}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card pad">
        <h1>Valet Link</h1>
        <p>{error}</p>
      </section>
    )
  }
  
  if(!v){ return <section className="card pad"><h1>Valet Link</h1><p>We couldn't find your valet details. Please check with the concierge.</p></section> }

  // normalized status to make rendering/guards consistent
  const status = String(v?.status || '').toLowerCase()

  async function onRequest(){
    if(sending) return
    if (String(v?.status || '').toLowerCase() === 'out') { alert('Vehicle is out and cannot be requested.'); return }
    setSending(true)
    try { await postGuestAction('request') } catch(e){ alert(e?.message || 'Unable to request right now.') } finally { setSending(false) }
  }

  async function onCancel(){
    if(sending) return
    setSending(true)
    try { await postGuestAction('cancel') } catch(e){ alert(e?.message || 'Unable to cancel right now.') } finally { setSending(false) }
  }

  async function onSchedule(){
    const el = document.getElementById('sched')
    if(!el || !el.value) return
    const when = new Date(el.value)
    if(isNaN(+when)){ alert('Please choose a valid date and time.'); return }
    if(when.getTime() - Date.now() < 10*60*1000){ alert('Please schedule at least 10 minutes in advance.'); return }
    try {
      await postGuestAction('schedule', { time: when.toISOString() })
    } catch (e) {
      alert(e?.message || 'Unable to schedule pickup right now.')
    }
  }

  const canRequest = status !== 'out' && status !== 'departed'
  const isDeparted = status === 'departed'
  
  // Safe vehicle description
  const vehicleDesc = [v.color, v.make, v.model].filter(x => !!(x || '').trim()).join(' ') || '—';

  return (
    <section className="card pad">
      <h1>Your Vehicle</h1>
      <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
        <div className="tag">Tag #{v.tag}</div>
        <StatusBadge status={v.status} />
      </div>

      {status === 'out' && (<p style={{marginTop:6}}><strong>Your vehicle is out &amp; about. Enjoy your drive!</strong></p>)}

      <div className="grid cols-2">
        <div className="field"><label>Guest</label><div>{v.guestName}</div></div>
        <div className="field"><label>Room Number</label><div>{v.roomNumber}</div></div>
        <div className="field"><label>Plate</label><div>{v.license || '—'}</div></div>
        <div className="field"><label>Vehicle</label><div>{vehicleDesc}</div></div>
        
        {!isDeparted && (
          <div className="field"><label>Schedule a pickup time</label>
            <div className="row">
              <input 
                type="datetime-local" 
                id="sched" 
                defaultValue="" 
                min={new Date(Date.now() + 10*60*1000).toISOString().slice(0, 16)}
              />
              <button className="btn secondary" onClick={onSchedule}>Schedule</button>
              {v.scheduledAt && <button className="btn secondary" onClick={async()=>{
                try {
                  await postGuestAction('clear')
                } catch (e) {
                  alert(e?.message || 'Unable to clear schedule right now.')
                }
              }}>Clear</button>}
            </div>
            {v.scheduledAt && <small style={{display: 'block', marginTop: 6, color: '#1e40af'}}>Pickup scheduled.</small>}
            {v.scheduledAt && <small>Scheduled for: {new Date(v.scheduledAt).toLocaleString()}</small>}
          </div>
        )}
      </div>

      {isDeparted && (
        <div style={{ 
          background: '#f8f9fa', 
          padding: '16px', 
          borderRadius: '8px', 
          marginTop: '24px',
          marginBottom: '16px',
          border: '1px solid #e0e0e0',
          textAlign: 'center'
        }}>
          <p style={{ fontSize: '1.0em', lineHeight: '1.6', margin: 0 }}>
            Thank you for staying at The Royce. We hope you enjoyed your visit and look forward to welcoming you back in the near future.
          </p>
          <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--muted)' }}>
            Safe travels!
          </p>
        </div>
      )}

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