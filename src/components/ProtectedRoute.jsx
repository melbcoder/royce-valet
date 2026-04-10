import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getCurrentUser } from '../services/valetFirestore';

export default function ProtectedRoute({ children, requiredPage }) {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check page-level access if requiredPage is specified
  if (requiredPage) {
    const currentUser = getCurrentUser();
    const isAdmin = currentUser?.role === 'admin';
    const userPages = currentUser?.pages || [];
    if (!isAdmin && !userPages.includes(requiredPage)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}