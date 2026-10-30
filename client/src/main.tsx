import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Елемент #root не знайдено в index.html');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Маршрути екранів студента й адміністратора додаються під час реалізації історій. */}
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
