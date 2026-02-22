import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { signOut, onAuthStateChanged } from 'firebase/auth';

export default function Nav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const isStaffPage = [
    '/dashboard',
    '/valet',
    '/valet-history',
    '/luggage',
    '/amenities',
    '/luggage-history',
    '/amenities-history',
    '/maintenance/jobs',
    '/maintenance/contractor-sign-in'
  ].includes(location.pathname);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to logout. Please try again.');
    }
  };

  if (!isAuthenticated) return null;

  const navLinkStyle = (isActive) => ({
    textDecoration: 'none',
    color: isActive ? '#000' : '#333',
    fontWeight: isActive ? 'bold' : 500,
    padding: '8px 12px',
    borderRadius: '6px',
    transition: 'background 0.2s',
    marginRight: '8px',
    background: 'transparent'
  });

  return (
    <>
      <NavLink to="/valet" style={({ isActive }) => navLinkStyle(isActive)}>
        Valet
      </NavLink>
      <NavLink to="/luggage" style={({ isActive }) => navLinkStyle(isActive)}>
        Luggage
      </NavLink>
      <NavLink to="/amenities" style={({ isActive }) => navLinkStyle(isActive)}>
        Amenities
      </NavLink>
      <div
        onMouseEnter={() => setMaintenanceOpen(true)}
        onMouseLeave={() => setMaintenanceOpen(false)}
        style={{ position: 'relative', display: 'inline-block' }}
      >
        <NavLink
          to="/maintenance/jobs"
          style={({ isActive }) => navLinkStyle(isActive)}
        >
          Maintenance ▾
        </NavLink>
        {maintenanceOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
              padding: 6,
              zIndex: 50,
              minWidth: 200
            }}
          >
            <NavLink
              to="/maintenance/jobs"
              style={({ isActive }) => ({
                ...navLinkStyle(isActive),
                display: 'block',
                marginRight: 0
              })}
            >
              Maintenance Jobs
            </NavLink>
            <NavLink
              to="/maintenance/contractor-sign-in"
              style={({ isActive }) => ({
                ...navLinkStyle(isActive),
                display: 'block',
                marginRight: 0
              })}
            >
              Contractor Sign In
            </NavLink>
          </div>
        )}
      </div>
      
      {isStaffPage && (
        <button 
          onClick={handleLogout}
          className="btn secondary"
          style={{ padding: '8px 16px', fontSize: '14px', marginLeft: '8px' }}
        >
          Logout
        </button>
      )}
    </>
  );
}