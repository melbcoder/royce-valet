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
      <NavLink to="/staff" style={linkStyle}>Staff</NavLink>
      <NavLink to="/history" style={linkStyle}>History</NavLink>
      
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

const linkStyle = {
  textDecoration: 'none',
  color: '#333',
  fontWeight: 500,
  padding: '8px 12px',
  borderRadius: '6px',
  transition: 'background 0.2s',
  marginRight: '8px'
};