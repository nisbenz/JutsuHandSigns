import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import FxGallery from './fx/FxGallery.jsx'

// Dev-only duel FX lab, kept out of production bundles.
const DuelLab = import.meta.env.DEV ? lazy(() => import('./dev/DuelLab.jsx')) : null

const fxlab = new URLSearchParams(window.location.search).get('fxlab')
const Root = fxlab === 'duel' && DuelLab ? DuelLab : fxlab !== null ? FxGallery : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
