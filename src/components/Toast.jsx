import React, { useEffect, useState } from 'react'
export default function ToastHost(){
  const [items, setItems] = useState([])
  useEffect(()=>{
    const h = (e)=>{
      const detail = e.detail || {}
      const id = Math.random().toString(36).slice(2)
      const item = { id, ...detail, show:false }
      setItems(prev => [...prev, item])
      setTimeout(()=> setItems(prev => prev.map(x=> x.id===id? {...x, show:true} : x)), 10)
      const ttl = detail.ttl ?? 3000
      setTimeout(()=> dismiss(id), ttl)
    }
    window.addEventListener('toast', h)
    return ()=> window.removeEventListener('toast', h)
  }, [])
  function dismiss(id){ setItems(prev => prev.map(x=> x.id===id? {...x, show:false} : x)); setTimeout(()=> setItems(prev => prev.filter(x=>x.id!==id)), 300) }
  return (
    <div className="toast-wrap">
      {items.map(t => (
        <div key={t.id} className={'toast'+(t.show?' show':'')}>
          <div className="row" style={{alignItems:'center'}}>
            <span>{t.message || 'Updated'}</span>
            <div className="row">
              {t.onUndo && <button className="btn secondary" onClick={()=>{ try{ t.onUndo() }catch{}; dismiss(t.id) }}>Undo</button>}
              <button className="btn secondary" onClick={()=>dismiss(t.id)}>Close</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
export function showToast(message, onUndo){
  const ev = new CustomEvent('toast', { detail: { message, onUndo } })
  window.dispatchEvent(ev)
}