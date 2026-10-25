import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import FxGallery from './fx/FxGallery.jsx'

const Root = new URLSearchParams(window.location.search).has('fxlab') ? FxGallery : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
