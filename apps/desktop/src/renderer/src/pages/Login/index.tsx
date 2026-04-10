import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import type { ServiceWindow } from '@announcement/shared'
import { MonitorPlay, ChevronRight, ChevronDown, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const { config, setPage, setOperatorSession, setActiveUser } = useAppStore()

  const [windows, setWindows] = useState<ServiceWindow[]>([])
  const [selectedWindowId, setSelectedWindowId] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.windows.list().then((wins) => {
      const active = (wins as ServiceWindow[]).filter((w) => w.isActive)
      setWindows(active)
      if (active.length > 0) setSelectedWindowId(active[0].id)
    })
  }, [])

  async function handleLogin() {
    if (!username.trim() || !password || !selectedWindowId) return
    setLoading(true)
    setError('')
    try {
      const user = await window.api.users.login(username.trim(), password)
      if (!user) {
        setError('Incorrect username or password')
        return
      }
      const win = windows.find((w) => w.id === selectedWindowId)
      const name = (user as any).displayName ?? win?.label ?? 'Operator'
      setActiveUser({
        id: (user as any).id,
        username: (user as any).username,
        displayName: name,
        role: (user as any).role,
        windowId: selectedWindowId,
      })
      setOperatorSession(name, selectedWindowId)
      setPage('operator')
    } finally {
      setLoading(false)
    }
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
          <p className="text-sm text-zinc-500 mt-1">Sign in to your panel</p>
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

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
              autoFocus
              autoComplete="username"
              placeholder="e.g. john"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 pl-4 pr-10 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Sign in button */}
          <button
            onClick={handleLogin}
            disabled={!selectedWindowId || !username.trim() || !password || loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <>Sign In <ChevronRight className="w-4 h-4" /></>
            }
          </button>
        </div>

        {/* Default credentials hint — shown only in dev or when seeded */}
        <p className="text-center text-xs text-zinc-700 mt-4">
          Default admin: <span className="text-zinc-500">admin / admin1234</span>
        </p>

      </div>
    </div>
  )
}
