import React from 'react'
export default function Settings({open, onClose}){
  if(!open) return null
  function clearData(){
    if(confirm('Clear all demo data? This will erase local vehicles and history.')){
      localStorage.removeItem('royce-valet-demo-v11')
      localStorage.removeItem('royce-valet-history')
      alert('Demo data cleared. Reloading…'); location.reload()
    }
  }
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}} onClick={onClose}>
      <div className="card pad" style={{width:'min(560px, 94vw)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <h1 style={{marginBottom:8}}>Settings</h1>
          <button className="btn secondary" onClick={onClose}>Close</button>
        </div>
        <div className="field">
          <label>Demo data</label>
          <button className="btn secondary" onClick={clearData}>Clear demo data</button>
        </div>
      </div>
    </div>
  )
}