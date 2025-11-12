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

  return (
    <nav style={{ 
      padding: '16px 24px', 
      background: '#fff', 
      borderBottom: '1px solid #e0e0e0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', gap: 16 }}>
        {isAuthenticated && (
          <>
            <NavLink to="/staff" style={linkStyle}>Staff</NavLink>
            <NavLink to="/history" style={linkStyle}>History</NavLink>
          </>
        )}
      </div>
      
      {isAuthenticated && isStaffOrHistory && (
        <button 
          onClick={handleLogout}
          className="btn secondary"
          style={{ padding: '8px 16px', fontSize: '14px' }}
        >
          Logout
        </button>
      )}
    </nav>
  );
}

const linkStyle = {
  textDecoration: 'none',
  color: '#333',
  fontWeight: 500,
  padding: '8px 12px',
  borderRadius: '6px',
  transition: 'background 0.2s'
};