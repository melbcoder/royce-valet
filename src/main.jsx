import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import Staff from './pages/Staff'
import Guest from './pages/Guest'
import History from './pages/History'
import NotFound from './pages/NotFound'
console.log('Royce Valet v1.8.5')
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Navigate to="/staff" replace />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/guest/:tag" element={<Guest />} />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)