import React from 'react'
export default function Modal({open, title, children, onClose}){
  if(!open) return null
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}} onClick={onClose}>
      <div className="card pad" style={{width:'min(680px, 94vw)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
          <h1 style={{marginBottom:0}}>{title}</h1>
          <button className="btn secondary" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}