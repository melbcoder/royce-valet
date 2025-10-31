import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createVehicle,subscribeActiveVehicles,updateVehicle,requestVehicle,cancelRequest,markReady,markOut,parkAgain,scheduleRequest,clearSchedule } from '../services/valetFirestore'
import Modal from '../components/Modal'
import { showToast } from '../components/Toast'

function StatusDropdown({value, onChange}){
  const [open, setOpen] = useState(false)
  const opts = [
    {key:'All', label:'All Statuses', dot:'dot-all'},
    {key:'Parked', label:'Parked', dot:'dot-parked'},
    {key:'Retrieving', label:'Retrieving', dot:'dot-retrieving'},
    {key:'Ready', label:'Ready', dot:'dot-ready'},
    {key:'Out', label:'Out', dot:'dot-out'},
  ]
  const selected = opts.find(o=>o.key===value) || opts[0]
  return (
    <div style={{position:'relative'}}>
      <button className="btn" onClick={()=>setOpen(o=>!o)} aria-expanded={open}>
        <span className={`dot ${selected.dot}`}></span>{selected.label}
      </button>
      {open && (
        <div className="card" style={{position:'absolute', top:'110%', left:0, zIndex:50, padding:8, minWidth:200}}>
          {opts.map(o=> (
            <button key={o.key} className="btn secondary" style={{width:'100%', justifyContent:'flex-start', marginBottom:6}} onClick={()=>{
              setOpen(false)
              if(o.key===value){ onChange('All') } else { onChange(o.key) }
            }}>
              <span className={`dot ${o.dot}`}></span>{o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Staff(){
  const [form, setForm] = useState({ guestName:'', roomNumber:'', phone:'', tag:'', departureDate:'', plate:'', make:'', model:'', colour:'', bay:'', notes:'' })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [vehicles, setVehicles] = useState([])
  const [errors, setErrors] = useState({})

  const [parkOpen, setParkOpen] = useState(false)
  const [parkForTag, setParkForTag] = useState('')
  const [parkForm, setParkForm] = useState({ bay:'', make:'', model:'', colour:'', plate:'' })

  const [departTodayOnly, setDepartTodayOnly] = useState(false)
  const [statusFilter, setStatusFilter] = useState('All')

  // Track unacknowledged requests for counter + chime
  const prevUnacked = useRef(new Set())
  const titleBase = useRef(document.title)

  const update = (k,v)=> setForm(s=>({...s, [k]:v}))
  useEffect(()=>{ const unsub = subscribeActiveVehicles(setVehicles); return () => unsub && unsub() }, [])

  // Promote scheduled pickups 10 min before to queue (requestVehicle clears schedule)
  const vehiclesRef = useRef([])
  useEffect(()=>{ vehiclesRef.current = vehicles }, [vehicles])
  useEffect(()=>{
    const id = setInterval(()=>{
      const now = Date.now()
      vehiclesRef.current.forEach(v => {
        if(!v.requested && v.scheduledAt){
          const due = Date.parse(v.scheduledAt)
          if(!isNaN(due) && now >= (due - 10*60*1000)){
            try{ requestVehicle(v.tag) }catch{}
          }
        }
      })
    }, 15000)
    return ()=> clearInterval(id)
  }, [])

  // Chime + tab badge for new unacknowledged requests; persist until acknowledged
  useEffect(()=>{
    const unacked = new Set(vehicles.filter(v=>v.requested && !v.ack).map(v=>String(v.tag)))
    const prev = prevUnacked.current
    let newOnes = 0
    unacked.forEach(tag => { if(!prev.has(tag)) newOnes++ })
    prevUnacked.current = unacked
    const count = unacked.size
    if(count>0){ document.title = `(${count}) Royce Valet` } else { document.title = titleBase.current || 'Royce Valet' }
    if(newOnes>0){
      try{
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const o = ctx.createOscillator(); const g = ctx.createGain()
        o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination)
        g.gain.setValueAtTime(0.0001, ctx.currentTime)
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime+0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.25)
        o.start(); o.stop(ctx.currentTime+0.26)
      }catch{}
    }
  }, [vehicles])

  const validateCreate = () => {
    const e = {}
    if(!form.guestName.trim()) e.guestName = 'Required'
    if(!form.roomNumber.trim()) e.roomNumber = 'Required'
    if(!form.phone.trim()) e.phone = 'Required'
    if(!form.tag.trim()) e.tag = 'Required'
    if(!form.departureDate?.trim()) e.departureDate = 'Required'
    setErrors(e); return Object.keys(e).length === 0
  }

  const onSubmit = async (ev)=>{
    ev.preventDefault()
    if(!validateCreate()) return
    try { await createVehicle(form); setForm({guestName:'', roomNumber:'', phone:'', tag:'', departureDate:'', plate:'', make:'', model:'', colour:'', bay:'', notes:''}); setShowAdvanced(false) }
    catch(e){ alert('Error: ' + (e?.message || e)) }
  }

  const onOpenPark = (v)=>{ setParkForTag(v.tag); setParkForm({ bay:'', make:v.make||'', model:v.model||'', colour:v.colour||'', plate:v.plate||'' }); setParkOpen(true) }
  const onConfirmPark = async ()=>{
    if(!String(parkForm.bay).trim()){ alert('Bay number is required.'); return }
    if(!String(parkForm.plate).trim()){ alert('Licence plate is required.'); return }
    try { await parkAgain(parkForTag, parkForm); setParkOpen(false) } catch(e){ alert('Error: ' + (e?.message || e)) }
  }

  const todayISO = new Date().toISOString().slice(0,10)
  const toMs = x => !x ? 0 : (typeof x === 'string' ? Date.parse(x) : x)
  const sorted = useMemo(()=> {
    let list = [...vehicles]
    if(departTodayOnly) list = list.filter(v=>v.departureDate === todayISO)
    if(statusFilter!=='All') list = list.filter(v=>v.status===statusFilter)
    return list.sort((a,b)=> String(a.tag||'').localeCompare(String(b.tag||'')))
  }, [vehicles, departTodayOnly, statusFilter, todayISO])

  const requests = useMemo(()=> [...vehicles].filter(v=>v.requested).sort((a,b)=> toMs(a.requestedAt)-toMs(b.requestedAt)), [vehicles])
  const unackedCount = requests.filter(v=>!v.ack).length

  const upcoming = useMemo(()=> {
    return [...vehicles].filter(v=>!!v.scheduledAt && !v.requested).sort((a,b)=> toMs(a.scheduledAt)-toMs(b.scheduledAt))
  }, [vehicles])

  async function handleHandOver(v){
    await markOut(v.tag)
    if((v.departureDate||'') === todayISO){
      const yes = confirm('This vehicle is scheduled to depart today. Has the guest departed?')
      if(yes){
        const snapshot = moveToHistory(v.tag)
        showToast('Vehicle departed and archived.', ()=>{
          if(snapshot){ restoreFromHistory(snapshot) }
        })
      }
    }
  }

  return (
    <>
      <div style={{position:'fixed', right:12, bottom:10, opacity:.5, fontSize:12, pointerEvents:'none'}}>Version 1.8.5</div>

      <section className="card pad">
        <h1>Valet Check-In</h1>
        <form onSubmit={onSubmit}>
          <div className="grid cols-2">
            <div className="field"><label>Guest name</label>
              <input value={form.guestName} onChange={e=>update('guestName', e.target.value)} />
              {errors.guestName && <small style={{color:'#b94b4b'}}>{errors.guestName}</small>}
            </div>
            <div className="field"><label>Room number</label>
              <input value={form.roomNumber} onChange={e=>update('roomNumber', e.target.value)} />
              {errors.roomNumber && <small style={{color:'#b94b4b'}}>{errors.roomNumber}</small>}
            </div>
            <div className="field"><label>Mobile number</label>
              <input value={form.phone} onChange={e=>update('mobile', e.target.value)} />
              {errors.phone && <small style={{color:'#b94b4b'}}>{errors.phone}</small>}
            </div>
            <div className="field"><label>Tag number</label>
              <input value={form.tag} onChange={e=>update('tag', e.target.value)} />
              {errors.tag && <small style={{color:'#b94b4b'}}>{errors.tag}</small>}
            </div>
            <div className="field"><label>Departure date</label>
              <input type="date" value={form.departureDate} onChange={e=>update('departureDate', e.target.value)} />
              {errors.departureDate && <small style={{color:'#b94b4b'}}>{errors.departureDate}</small>}
            </div>
          </div>
          <div className="row" style={{marginTop:10}}>
            <button type="button" className="btn secondary" onClick={()=>setShowAdvanced(s=>!s)}>{showAdvanced ? 'Hide vehicle details' : 'Add vehicle details (optional)'}</button>
          </div>
          {showAdvanced && (
            <div className="grid cols-2" style={{marginTop:10}}>
              <div className="field"><label>Licence plate (optional)</label>
                <input value={form.plate} onChange={e=>update('plate', e.target.value)} />
              </div>
              <div className="field"><label>Make (optional)</label>
                <input value={form.make} onChange={e=>update('make', e.target.value)} />
              </div>
              <div className="field"><label>Model (optional)</label>
                <input value={form.model} onChange={e=>update('model', e.target.value)} />
              </div>
              <div className="field"><label>Colour (optional)</label>
                <input value={form.colour} onChange={e=>update('colour', e.target.value)} />
              </div>
              <div className="field" style={{gridColumn:'1/-1'}}><label>Notes (optional)</label>
                <textarea rows="3" value={form.notes} onChange={e=>update('notes', e.target.value)} />
              </div>
            </div>
          )}
          <div className="row" style={{justifyContent:'flex-end', marginTop:12}}>
            <button className="btn btn-dark" type="submit">Create Vehicle</button>
          </div>
        </form>
      </section>

      <section className="card pad" style={{marginTop:16}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <h1>Request Queue <span className="badge">{unackedCount}</span></h1>
        </div>
        <div style={{overflowX:'auto'}}>
          <table>
            <thead>
              <tr><th>Tag</th><th>Guest</th><th>Requested at</th><th>Scheduled for</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {requests.length===0 && <tr><td colSpan="6" style={{padding:14, textAlign:'center', opacity:.7}}>No requests yet</td></tr>}
              {requests.map(v => (
                <tr key={v.tag}>
                  <td>{v.tag}</td>
                  <td>{v.guestName} (#{v.roomNumber})</td>
                  <td>{v.requestedAt ? new Date(v.requestedAt).toLocaleString() : '—'}</td>
                  <td>{v.scheduledAt ? new Date(v.scheduledAt).toLocaleString() : '—'}</td>
                  <td><span className={'status-pill ' + (v.status==='Ready'?'status-ready':(v.status==='Retrieving'?'status-retrieving':(v.status==='Out'?'status-out':'status-parked')))}>{v.status==='Out'?'Out & About':v.status}</span></td>
                  <td className="row">
                    {!v.ack && (
                      <button className="btn" onClick={()=>requestVehicle(v.tag)}>Acknowledge</button>
                    )}
                    {v.ack && v.status==='Retrieving' && (
                      <button className="btn" onClick={()=>markReady(v.tag)}>Mark Ready</button>
                    )}
                    {v.ack && v.status==='Ready' && (
                      <button className="btn" onClick={()=>handleHandOver(v)}>Hand Over</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card pad" style={{marginTop:16}}>
        <h1>Scheduled Pickups</h1>
        <div style={{overflowX:'auto'}}>
          <table>
            <thead>
              <tr>
                <th>Tag</th><th>Guest</th><th>Scheduled for</th><th>Vehicle</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length===0 && <tr><td colSpan="6" style={{padding:14, textAlign:'center', opacity:.7}}>No scheduled pickups</td></tr>}
              {upcoming.map(v => {
                const due = Date.parse(v.scheduledAt || 0)
                const warnWindow = !Number.isNaN(due) && (Date.now() >= (due - 10*60*1000))
                const warn = warnWindow && v.status!=='Parked'
                return (
                <tr key={'upcoming-'+v.tag} style={warn ? {outline:'2px solid rgba(191,164,111,.7)', outlineOffset:2, background:'rgba(191,164,111,.08)'} : {}}>
                  <td>#{v.tag}</td>
                  <td>{v.guestName} (#{v.roomNumber})</td>
                  <td>{v.scheduledAt ? new Date(v.scheduledAt).toLocaleString() : '—'}</td>
                  <td>{[v.colour, v.make, v.model].filter(x=>!!(x||'').trim()).join(' ')} {v.plate? '• '+v.plate : ''}</td>
                  <td><span className={'status-pill ' + (v.status==='Ready'?'status-ready':(v.status==='Retrieving'?'status-retrieving':(v.status==='Out'?'status-out':'status-parked')))}>{v.status==='Out'?'Out & About':v.status}</span></td>
                  <td className="row">
                    <button className="btn" onClick={async()=>{
                      const val = prompt('Enter a new date & time (local). Leave blank to cancel.')
                      if(val===null) return
                      if(!val.trim()) return
                      const when = new Date(val)
                      if(isNaN(+when)){ alert('Please enter a valid date/time'); return }
                      await scheduleRequest(v.tag, when.toISOString())
                    }}>Adjust</button>
                    <button className="btn secondary" onClick={()=>clearSchedule(v.tag)}>Clear</button>
                  </td>
                </tr>)
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card pad" style={{marginTop:16}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8}}>
          <h1>Active Vehicles</h1>
          <div className="row" style={{gap:8}}>
            <StatusDropdown value={statusFilter} onChange={setStatusFilter} />
            <button className={departTodayOnly ? 'btn btn-dark' : 'btn'} onClick={()=>setDepartTodayOnly(s=>!s)}>
              {departTodayOnly ? 'Show All Vehicles' : 'Show Departing Today'}
            </button>
          </div>
        </div>
        <div style={{overflowX:'auto'}}>
          <table>
            <thead>
              <tr>
                <th>Tag</th><th>Bay</th><th>Guest</th><th>Vehicle</th><th>Status</th><th>Requested</th><th>Actions</th><th>Departure Date</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && <tr><td colSpan="8" style={{padding:'20px', textAlign:'center', opacity:.75}}>No vehicles yet</td></tr>}
              {sorted.map(v => (
                <tr key={v.tag}>
                  <td>{v.tag}</td>
                  <td>{v.bay || '—'}</td>
                  <td>{v.guestName} (#{v.roomNumber})</td>
                  <td>{[v.colour, v.make, v.model].filter(x=>!!(x||'').trim()).join(' ')} {v.plate? '• '+v.plate : ''}</td>
                  <td><span className={'status-pill ' + (v.status==='Ready'?'status-ready':(v.status==='Retrieving'?'status-retrieving':(v.status==='Out'?'status-out':'status-parked')))}>{v.status==='Out'?'Out & About':v.status}</span></td>
                  <td>{v.requested ? (v.ack ? 'Yes (Ack)' : 'Yes') : '—'}</td>
                  <td className="row">
                    <button className="btn" onClick={()=>updateVehicle(v.tag,'Ready')}>Ready</button>
                    <button className="btn" onClick={()=>handleHandOver(v)}>Hand Over</button>
                    <button className="btn" onClick={()=>{ setParkForm({ bay:'', make:v.make||'', model:v.model||'', colour:v.colour||'', plate:v.plate||'' }); setParkForTag(v.tag); setParkOpen(true) }}>{v.status==='Parked' ? 'Park Again' : 'Park'}</button>
                  </td>
                  <td>
                    <input type="date" value={v.departureDate || ''} onChange={e=>{
                      const prev = v.departureDate || ''
                      const next = e.target.value
                      updateDepartureDate(v.tag, next)
                      showToast('Departure date updated successfully.', ()=> updateDepartureDate(v.tag, prev))
                    }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={parkOpen} title={`Park vehicle #${parkForTag}`} onClose={()=>setParkOpen(false)}>
        <div className="grid cols-2">
          <div className="field"><label>Bay number</label>
            <input value={parkForm.bay} onChange={e=>setParkForm(s=>({...s, bay:e.target.value}))} />
          </div>
          <div className="field"><label>Licence plate</label>
            <input value={parkForm.plate} onChange={e=>setParkForm(s=>({...s, plate:e.target.value}))} />
          </div>
          <div className="field"><label>Make (required)</label>
            <input value={parkForm.make} onChange={e=>setParkForm(s=>({...s, make:e.target.value}))} />
          </div>
          <div className="field"><label>Model (optional)</label>
            <input value={parkForm.model} onChange={e=>setParkForm(s=>({...s, model:e.target.value}))} />
          </div>
          <div className="field"><label>Colour (required)</label>
            <input value={parkForm.colour} onChange={e=>setParkForm(s=>({...s, colour:e.target.value}))} />
          </div>
        </div>
        <div className="row" style={{justifyContent:'flex-end', marginTop:12}}>
          <button className="btn secondary" onClick={()=>setParkOpen(false)}>Cancel</button>
          <button className="btn btn-dark" onClick={onConfirmPark}>Confirm Park</button>
        </div>
      </Modal>
    </>
  )
}