import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export default function ProtectedRoute({ children, requiredPage }) {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      if (!user) {
        setIsAuthenticated(false);
        setIsAuthorized(false);
        setLoading(false);
        return;
      }

      setIsAuthenticated(true);

      if (!requiredPage) {
        setIsAuthorized(true);
        setLoading(false);
        return;
      }

      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const userData = userSnap.exists() ? userSnap.data() : {};
        const isAdmin = userData?.role === 'admin';
        const pages = Array.isArray(userData?.pages) ? userData.pages : [];
        setIsAuthorized(isAdmin || pages.includes(requiredPage));
      } catch (error) {
        console.error('ProtectedRoute authorization check failed:', error);
        setIsAuthorized(false);
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [requiredPage]);

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

  if (requiredPage && !isAuthorized) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}