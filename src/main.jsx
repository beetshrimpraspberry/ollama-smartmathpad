import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import NeoCalcUI from './NeoCalcUI.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NeoCalcUI />} />
        <Route path="/neo" element={<Navigate to="/" replace />} />
        <Route path="/old" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
