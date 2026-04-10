import { create } from 'zustand'
import type { InstallationConfig, CallingMode, Sector, SupportedLanguage } from '@announcement/shared'

type AppPage = 'setup' | 'login' | 'operator' | 'display' | 'summary' | 'kiosk' | 'settings' | 'analytics' | 'expired'

interface AppStore {
  page: AppPage
  isSetupComplete: boolean
  config: InstallationConfig | null
  isDisplayOpen: boolean
  updateAvailable: boolean
  updateDownloaded: boolean
  operatorName: string
  operatorWindowId: string

  setPage: (page: AppPage) => void
  setConfig: (config: InstallationConfig) => void
  setSetupComplete: (v: boolean) => void
  setDisplayOpen: (v: boolean) => void
  setUpdateAvailable: (v: boolean) => void
  setUpdateDownloaded: (v: boolean) => void
  setOperatorSession: (name: string, windowId: string) => void
}

export const useAppStore = create<AppStore>((set) => ({
  page: 'setup',
  isSetupComplete: false,
  config: null,
  isDisplayOpen: false,
  updateAvailable: false,
  updateDownloaded: false,
  operatorName: '',
  operatorWindowId: '',

  setPage: (page) => set({ page }),
  setConfig: (config) => set({ config }),
  setSetupComplete: (isSetupComplete) => set({ isSetupComplete }),
  setDisplayOpen: (isDisplayOpen) => set({ isDisplayOpen }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  setUpdateDownloaded: (updateDownloaded) => set({ updateDownloaded }),
  setOperatorSession: (operatorName, operatorWindowId) => set({ operatorName, operatorWindowId }),
}))
