import { create } from 'zustand'
import type { InstallationConfig, CallingMode, Sector, SupportedLanguage, UserRole } from '@announcement/shared'

type AppPage = 'setup' | 'login' | 'operator' | 'display' | 'summary' | 'kiosk' | 'settings' | 'analytics' | 'feedback-report' | 'expired'

export interface ActiveUser {
  id: string
  username: string
  displayName: string
  role: UserRole
  windowId?: string
}

interface AppStore {
  page: AppPage
  isSetupComplete: boolean
  config: InstallationConfig | null
  isDisplayOpen: boolean
  updateAvailable: boolean
  updateDownloaded: boolean
  operatorName: string
  operatorWindowId: string
  settingsInitialTab: string | null
  /** Currently logged-in user (null = not logged in / legacy PIN mode) */
  activeUser: ActiveUser | null
  /** Department (category) the current operator is working in — null means all */
  activeCategoryId: string | null

  setPage: (page: AppPage) => void
  setConfig: (config: InstallationConfig) => void
  setSetupComplete: (v: boolean) => void
  setDisplayOpen: (v: boolean) => void
  setUpdateAvailable: (v: boolean) => void
  setUpdateDownloaded: (v: boolean) => void
  setOperatorSession: (name: string, windowId: string) => void
  setSettingsInitialTab: (tab: string | null) => void
  setActiveUser: (user: ActiveUser | null) => void
  setActiveCategoryId: (id: string | null) => void
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
  settingsInitialTab: null,
  activeUser: null,
  activeCategoryId: null,

  setPage: (page) => set({ page }),
  setConfig: (config) => set({ config }),
  setSetupComplete: (isSetupComplete) => set({ isSetupComplete }),
  setDisplayOpen: (isDisplayOpen) => set({ isDisplayOpen }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  setUpdateDownloaded: (updateDownloaded) => set({ updateDownloaded }),
  setOperatorSession: (operatorName, operatorWindowId) => set({ operatorName, operatorWindowId }),
  setSettingsInitialTab: (settingsInitialTab) => set({ settingsInitialTab }),
  setActiveUser: (activeUser) => set({ activeUser }),
  setActiveCategoryId: (activeCategoryId) => set({ activeCategoryId }),
}))
