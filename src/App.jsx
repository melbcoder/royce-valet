import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Guest from './pages/Guest';
import Valet from './pages/Valet';
import ValetHistory from './pages/ValetHistory';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Luggage from './pages/Luggage';
import Amenities from './pages/Amenities';
import LuggageHistory from './pages/LuggageHistory';
import AmenitiesHistory from './pages/AmenitiesHistory';
import ProtectedRoute from './components/ProtectedRoute';
import Nav from './components/Nav';
import ToastHost from './components/Toast';
import Settings from './components/Settings';
import ForceChangePassword from './components/ForceChangePassword';

function Logo() {
  const navigate = useNavigate();
  return (
    <div className="brand" onClick={() => navigate('/dashboard')} style={{ cursor: 'pointer' }}>
      <img src="/royce-logo.jpg" alt="The Royce" />
    </div>
  );
}

export default function App(){
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <Router>
      <ToastHost />
      <div>
        <div className="topbar">
          <div className="inner container">
            <Logo />
            <div className="row">
              <Nav />
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
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/force-change-password" element={<ForceChangePassword />} />
            <Route path="/guest/:tag" element={<Guest />} />
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/valet" 
              element={
                <ProtectedRoute>
                  <Valet />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/valet-history" 
              element={
                <ProtectedRoute>
                  <ValetHistory />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/luggage" 
              element={
                <ProtectedRoute>
                  <Luggage />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/amenities" 
              element={
                <ProtectedRoute>
                  <Amenities />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/luggage-history" 
              element={
                <ProtectedRoute>
                  <LuggageHistory />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/amenities-history" 
              element={
                <ProtectedRoute>
                  <AmenitiesHistory />
                </ProtectedRoute>
              } 
            />
          </Routes>
          <div style={{position:'fixed', right:12, bottom:10, opacity:.5, fontSize:12, pointerEvents:'none'}}>Version 1.8.5</div>
        </main>
        <Settings open={settingsOpen} onClose={()=>setSettingsOpen(false)} />
      </div>
    </Router>
  )
}