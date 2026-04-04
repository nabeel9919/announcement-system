import { useEffect } from 'react'
import { useAppStore } from './store/app'
import SetupPage from './pages/Setup'
import OperatorPage from './pages/Operator'
import DisplayPage from './pages/Display'
import DaySummaryPage from './pages/DaySummary'
import KioskPage from './pages/Kiosk'
import SettingsPage from './pages/Settings'
import AnalyticsPage from './pages/Analytics'
import LicenseExpiredPage from './pages/LicenseExpired'

export default function App() {
  const { page, setPage, setConfig, setSetupComplete, setUpdateAvailable, setUpdateDownloaded } =
    useAppStore()

  useEffect(() => {
    async function init() {
      const config = await window.api.config.read()
      if (config?.isSetupComplete && config?.installationConfig) {
        setConfig(config.installationConfig)
        setSetupComplete(true)
        // Check if we're the display window
        if (window.location.hash === '#/display' || window.location.hash === '#display') {
          setPage('display')
        } else if (window.location.hash === '#/kiosk' || window.location.hash === '#kiosk') {
          setPage('kiosk')
        } else {
          setPage('operator')
        }
      } else {
        setPage('setup')
      }
    }
    init()

    // Listen for navigation events from main process
    window.api.onNavigate((route) => {
      if (route === '/setup') setPage('setup')
      if (route === '/operator') setPage('operator')
      if (route === '/display') setPage('display')
      if (route === '/kiosk') setPage('kiosk')
      if (route === '/expired') setPage('expired')
    })

    // Listen for update events
    window.api.updater.onAvailable(() => setUpdateAvailable(true))
    window.api.updater.onDownloaded(() => setUpdateDownloaded(true))

    // Display window: listen for queue updates
    window.api.display.onUpdate((_payload) => {
      // Display page handles this via its own listener
    })
  }, [])

  if (page === 'setup') return <SetupPage />
  if (page === 'expired') return <LicenseExpiredPage />
  if (page === 'display') return <DisplayPage />
  if (page === 'kiosk') return <KioskPage />
  if (page === 'summary') return <DaySummaryPage />
  if (page === 'settings') return <SettingsPage />
  if (page === 'analytics') return <AnalyticsPage />
  return <OperatorPage />
}
