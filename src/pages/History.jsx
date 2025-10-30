import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
export default function History(){
  const [history, setHistory] = useState([])
  const [search, setSearch] = useState('')
  useEffect(()=>{
    try{
      const key = 'royce-valet-history'
      const raw = JSON.parse(localStorage.getItem(key) || '[]')
      const cutoff = Date.now() - 7*24*60*60*1000
      const recent = raw.filter(v=> !v.departedAt || Date.parse(v.departedAt) >= cutoff )
      localStorage.setItem(key, JSON.stringify(recent))
      setHistory(recent.sort((a,b)=> new Date(b.departedAt||0) - new Date(a.departedAt||0)))
    }catch{ setHistory([]) }
  }, [])
  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase()
    if(!q) return history
    return history.filter(v =>
      (v.guestName||'').toLowerCase().includes(q) ||
      String(v.tag||'').toLowerCase().includes(q) ||
      String(v.plate||'').toLowerCase().includes(q)
    )
  }, [search, history])
  const grouped = useMemo(()=>{
    return filtered.reduce((acc, v)=>{
      const key = v.departureDate || 'Unknown'
      if(!acc[key]) acc[key] = []
      acc[key].push(v)
      return acc
    }, {})
  }, [filtered])
  const groups = Object.keys(grouped).sort((a,b)=> new Date(b) - new Date(a))
  const total = history.length
  const shown = filtered.length
  return (
    <section className="card pad">
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>History</h1>
        <Link to="/staff" className="btn secondary">Back to Dashboard</Link>
      </div>
      <div className="field" style={{marginTop:12}}>
        <input placeholder="Search by guest, tag, or plate" value={search} onChange={e=>setSearch(e.target.value)} />
        {search && <button className="btn secondary" style={{marginTop:8}} onClick={()=>setSearch('')}>Clear</button>}
      </div>
      <p style={{marginTop:8, color:'var(--muted)'}}>Showing {shown}{shown!==total?` of ${total}`:''} vehicle{shown===1?'':'s'} departed in the last 7 days</p>
      {groups.length===0 && <p style={{opacity:.7, marginTop:16}}>No departures in the last 7 days.</p>}
      {groups.map(date => (
        <div key={date} style={{marginTop:20}}>
          <h2 style={{marginBottom:8}}>Departed {date}</h2>
          <div style={{overflowX:'auto'}}>
            <table>
              <thead>
                <tr><th>Tag</th><th>Guest</th><th>Vehicle</th><th>Departure</th><th>Handover</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {grouped[date].map(v => (
                  <tr key={`${date}-${v.tag}`}>
                    <td>{v.tag}</td>
                    <td>{v.guestName} (#{v.roomNumber})</td>
                    <td>{[v.colour, v.make, v.model].filter(Boolean).join(' ')} {v.plate? '• '+v.plate : ''}</td>
                    <td>{v.departureDate || '—'}</td>
                    <td>{v.departedAt ? new Date(v.departedAt).toLocaleString() : '—'}</td>
                    <td>{v.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  )
}