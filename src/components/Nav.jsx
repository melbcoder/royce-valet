import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';

export default function Nav() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = sessionStorage.getItem('staffAuthenticated') === 'true';
  const isStaffOrHistory = location.pathname === '/staff' || location.pathname === '/history';

  const handleLogout = () => {
    sessionStorage.removeItem('staffAuthenticated');
    navigate('/login');
  };

  if (!isAuthenticated) return null;

  return (
    <>
      <NavLink 
        to="/staff" 
        style={({ isActive }) => ({
          textDecoration: 'none',
          color: isActive ? '#000' : '#333',
          fontWeight: isActive ? 600 : 500,
          padding: '8px 12px',
          borderRadius: '6px',
          transition: 'background 0.2s',
          marginRight: '8px',
          background: isActive ? '#f0f0f0' : 'transparent'
        })}
      >
        Staff
      </NavLink>
      <NavLink 
        to="/history" 
        style={({ isActive }) => ({
          textDecoration: 'none',
          color: isActive ? '#000' : '#333',
          fontWeight: isActive ? 600 : 500,
          padding: '8px 12px',
          borderRadius: '6px',
          transition: 'background 0.2s',
          marginRight: '8px',
          background: isActive ? '#f0f0f0' : 'transparent'
        })}
      >
        History
      </NavLink>
      
      {isStaffOrHistory && (
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