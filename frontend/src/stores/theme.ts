import { create } from 'zustand'

export type ThemeId = 'dark' | 'light' | 'dark-blur' | 'light-blur' | 'solarized-dark' | 'nord' | 'rose-pine'

export interface ThemeOption {
  id: ThemeId
  label: string
  group: 'Glass' | 'Community'
}

export const THEMES: ThemeOption[] = [
  { id: 'dark', label: 'Glass Dark', group: 'Glass' },
  { id: 'light', label: 'Glass Light', group: 'Glass' },
  { id: 'dark-blur', label: 'Glass Dark Blur', group: 'Glass' },
  { id: 'light-blur', label: 'Glass Light Blur', group: 'Glass' },
  { id: 'solarized-dark', label: 'Solarized Dark', group: 'Community' },
  { id: 'nord', label: 'Nord', group: 'Community' },
  { id: 'rose-pine', label: 'Rosé Pine', group: 'Community' },
]

interface ThemeState {
  themeId: ThemeId
  setTheme: (id: ThemeId) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeId: 'dark',
  setTheme: (id) => {
    document.documentElement.setAttribute('data-theme', id)
    set({ themeId: id })
  },
}))
