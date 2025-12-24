import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';

export default function Nav() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = sessionStorage.getItem('staffAuthenticated') === 'true';
  const isStaffPage = ['/valet', '/valet-history', '/luggage', '/amenities', '/luggage-history', '/amenities-history'].includes(location.pathname);

  const handleLogout = () => {
    sessionStorage.removeItem('staffAuthenticated');
    navigate('/login');
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