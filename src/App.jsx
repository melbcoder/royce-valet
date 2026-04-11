import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Guest from './pages/Guest';
import Valet from './pages/Valet';
import ValetHistory from './pages/ValetHistory';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Luggage from './pages/Luggage';
import Amenities from './pages/Amenities';
import LuggageHistory from './pages/LuggageHistory';
import AmenitiesHistory from './pages/AmenitiesHistory';
import MaintenanceJobs from './pages/MaintenanceJobs';
import ContractorSignIn from './pages/ContractorSignIn';
import MaintenanceDashboard from './pages/MaintenanceDashboard';
import AccountsPayable from './pages/AccountsPayable';
import TravelAgentDatabase from './pages/TravelAgentDatabase';
import SupplierDatabase from './pages/SupplierDatabase';
import QRLogin from './pages/QRLogin';
import ProtectedRoute from './components/ProtectedRoute';
import Nav from './components/Nav';
import ToastHost from './components/Toast';
import Settings from './components/Settings';
import ForceChangePassword from './components/ForceChangePassword';
import ForgotPassword from './components/ForgotPassword';
import { sessionManager } from './utils/sessionManager';
import { getCurrentUser } from './services/valetFirestore';

function Logo() {
  const navigate = useNavigate();
  return (
    <div className="brand" onClick={() => navigate('/dashboard')} style={{ cursor: 'pointer' }}>
      <img src="/royce-logo.jpg" alt="The Royce" />
    </div>
  );
}

function PublicLogo() {
  return (
    <div className="brand" style={{ cursor: 'default' }}>
      <img src="/royce-logo.jpg" alt="The Royce" />
    </div>
  );
}

export default function App(){
  const navigate = useNavigate();
  const location = useLocation();
  const isPublicPage = location.pathname === '/login'
    || location.pathname === '/forgot-password'
    || location.pathname === '/force-change-password'
    || location.pathname === '/qr-login'
    || location.pathname.startsWith('/guest/');

  useEffect(() => {
    const currentUser = getCurrentUser();
    
    if (currentUser) {
      // Start session monitoring if user is logged in
      if (sessionManager.isSessionValid()) {
        sessionManager.startSession();
      } else {
        // Session expired, clear user and redirect to login
        sessionManager.endSession();
      }
    }
  }, []);

  // Check session validity on route changes
  useEffect(() => {
    const currentUser = getCurrentUser();
    
    if (currentUser && !sessionManager.isSessionValid()) {
      sessionManager.endSession();
    }
  }, [location.pathname]);

  return (
    <>
      <ToastHost />
      <div>
        {isPublicPage && (
          <div className="topbar">
            <div className="inner container" style={{ display: 'flex', justifyContent: 'center' }}>
              <PublicLogo />
            </div>
          </div>
        )}

        {!isPublicPage && (
          <div className="topbar">
            <div className="inner container">
              <Logo />
              <div className="row topbar-controls">
                <Nav />
                <button className="tag settings-shortcut" onClick={()=>navigate('/settings')} title="Settings" style={{background:'#fff', cursor:'pointer'}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 21 12h.09A2 2 0 1 1 21 16h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  <span>Settings</span>
                </button>
              </div>
            </div>
          </div>
        )}
        <main className="container" style={{paddingTop:24, paddingBottom:40}}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/force-change-password" element={<ForceChangePassword />} />
            <Route path="/qr-login" element={<QRLogin />} />
            <Route path="/guest/:accessToken" element={<Guest />} />
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
                <ProtectedRoute requiredPage="valet">
                  <Valet />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/valet-history" 
              element={
                <ProtectedRoute requiredPage="valet-history">
                  <ValetHistory />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/luggage" 
              element={
                <ProtectedRoute requiredPage="luggage">
                  <Luggage />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/amenities" 
              element={
                <ProtectedRoute requiredPage="amenities">
                  <Amenities />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/luggage-history" 
              element={
                <ProtectedRoute requiredPage="luggage-history">
                  <LuggageHistory />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/amenities-history" 
              element={
                <ProtectedRoute requiredPage="amenities-history">
                  <AmenitiesHistory />
                </ProtectedRoute>
              } 
            />
            <Route
              path="/maintenance"
              element={
                <ProtectedRoute requiredPage="maintenance">
                  <MaintenanceDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/maintenance/jobs"
              element={
                <ProtectedRoute requiredPage="maintenance">
                  <MaintenanceJobs />
                </ProtectedRoute>
              }
            />
            <Route
              path="/maintenance/contractor-sign-in"
              element={
                <ProtectedRoute requiredPage="maintenance">
                  <ContractorSignIn />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts-payable"
              element={
                <ProtectedRoute requiredPage="accounts-payable">
                  <AccountsPayable />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts-payable/travel-agents"
              element={
                <ProtectedRoute requiredPage="accounts-payable">
                  <TravelAgentDatabase />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts-payable/suppliers"
              element={
                <ProtectedRoute requiredPage="accounts-payable">
                  <SupplierDatabase />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings asPage onClose={() => navigate('/dashboard')} />
                </ProtectedRoute>
              }
            />
          </Routes>
          <div className="version-badge" style={{position:'fixed', right:12, bottom:10, opacity:.5, fontSize:12, pointerEvents:'none'}}>Version 1.8.5</div>
        </main>
      </div>
    </>
  )
}