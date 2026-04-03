import { create } from 'zustand'
import type { InstallationConfig, CallingMode, Sector, SupportedLanguage } from '@announcement/shared'

type AppPage = 'setup' | 'operator' | 'display' | 'summary' | 'kiosk'

interface AppStore {
  page: AppPage
  isSetupComplete: boolean
  config: InstallationConfig | null
  isDisplayOpen: boolean
  updateAvailable: boolean
  updateDownloaded: boolean

  setPage: (page: AppPage) => void
  setConfig: (config: InstallationConfig) => void
  setSetupComplete: (v: boolean) => void
  setDisplayOpen: (v: boolean) => void
  setUpdateAvailable: (v: boolean) => void
  setUpdateDownloaded: (v: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  page: 'setup',
  isSetupComplete: false,
  config: null,
  isDisplayOpen: false,
  updateAvailable: false,
  updateDownloaded: false,

  setPage: (page) => set({ page }),
  setConfig: (config) => set({ config }),
  setSetupComplete: (isSetupComplete) => set({ isSetupComplete }),
  setDisplayOpen: (isDisplayOpen) => set({ isDisplayOpen }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  setUpdateDownloaded: (updateDownloaded) => set({ updateDownloaded }),
}))
