import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Poll for a new service worker every hour instead of only on a cold page
// load — an installed PWA opened from its home-screen icon rarely does a
// full fresh navigation, so without this it can stay stuck running a stale
// cached build (old JS + old ffmpeg-core.wasm) indefinitely. `autoUpdate`
// already forces skipWaiting/clientsClaim, so once an update is detected it
// activates and reloads on its own — this just makes sure that check
// actually happens.
registerSW({
  immediate: true,
  onRegistered(registration) {
    if (!registration) return
    setInterval(() => registration.update(), 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
