import React, { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import Settings from './components/Settings'
import ToastHost from './components/Toast'
export default function App(){
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div>
      <div className="topbar">
        <div className="inner container">
          <div className="brand">
            <img src="/royce-logo.jpg" alt="The Royce" />
            <span style={{fontFamily:'Playfair Display, serif', fontSize:18, letterSpacing:'.04em'}}>Valet</span>
          </div>
          <div className="row">
            <Link className="tag" to="/staff">Staff</Link>
            <Link className="tag" to="/guest/045">Guest Demo</Link>
            <Link className="tag" to="/history" title="History" style={{display:'flex',alignItems:'center',gap:6}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v4l3 3"/>
                <path d="M3 12a9 9 0 1 0 3-6.7"/>
                <path d="M3 3v6h6"/>
              </svg>
              <span>History</span>
            </Link>
            <button className="tag" onClick={()=>setSettingsOpen(true)} title="Settings" style={{background:'#fff', cursor:'pointer'}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 21 12h.09A2 2 0 1 1 21 16h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>Settings</span>
            </button>
          </div>
        </div>
      </div>
      <main className="container" style={{paddingTop:24, paddingBottom:40}}>
        <ToastHost />
        <Outlet />
        <div style={{position:'fixed', right:12, bottom:10, opacity:.5, fontSize:12, pointerEvents:'none'}}>Version 1.8.5</div>
      </main>
      <Settings open={settingsOpen} onClose={()=>setSettingsOpen(false)} />
    </div>
  )
}