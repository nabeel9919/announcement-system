import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import type { ServiceWindow } from '@announcement/shared'
import { MonitorPlay, ChevronRight, ChevronDown } from 'lucide-react'

export default function LoginPage() {
  const { config, setPage, setOperatorSession } = useAppStore()

  const [windows, setWindows] = useState<ServiceWindow[]>([])
  const [selectedWindowId, setSelectedWindowId] = useState('')

  useEffect(() => {
    window.api.windows.list().then((wins) => {
      const active = (wins as ServiceWindow[]).filter((w) => w.isActive)
      setWindows(active)
      if (active.length > 0) setSelectedWindowId(active[0].id)
    })
  }, [])

  function handleEnter() {
    if (!selectedWindowId) return
    const win = windows.find((w) => w.id === selectedWindowId)
    const name = win?.label ?? 'Operator'
    setOperatorSession(name, selectedWindowId)
    setPage('operator')
  }

  return (
    <div
      className="flex h-screen items-center justify-center text-zinc-50 select-none"
      style={{ background: '#0a0a0f' }}
    >
      <div className="w-full max-w-xs px-4">

        {/* Logo + org name */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-600/30">
            <MonitorPlay className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-zinc-100">
            {config?.organizationName ?? 'Announcement System'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Select your window to continue</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">

          {/* Window dropdown */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
              Service Window
            </label>
            <div className="relative">
              <select
                value={selectedWindowId}
                onChange={(e) => setSelectedWindowId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && selectedWindowId) handleEnter() }}
                autoFocus
                className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-800/80 pl-4 pr-10 py-3 text-sm font-medium text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors cursor-pointer"
              >
                {windows.length === 0 && (
                  <option value="">No windows configured</option>
                )}
                {windows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}{w.operatorName ? ` — ${w.operatorName}` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            </div>
          </div>

          {/* Enter button */}
          <button
            onClick={handleEnter}
            disabled={!selectedWindowId}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            Enter Panel
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  )
}
