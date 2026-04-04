'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Key, CreditCard, BarChart2,
  Settings, MonitorPlay, LogOut, RefreshCw,
} from 'lucide-react'

const NAV = [
  { href: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/clients',        label: 'Clients',         icon: Users },
  { href: '/licenses',       label: 'Licenses',        icon: Key },
  { href: '/subscriptions',  label: 'Subscriptions',   icon: RefreshCw },
  { href: '/billing',        label: 'Billing & Plans', icon: CreditCard },
  { href: '/analytics',      label: 'Analytics',       icon: BarChart2 },
  { href: '/settings',       label: 'Settings',        icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-60 flex-shrink-0 border-r border-zinc-800 bg-zinc-900/50 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="p-5 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
            <MonitorPlay className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Announcement</p>
            <p className="text-xs text-zinc-500">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
              pathname.startsWith(href)
                ? 'bg-primary-600/20 text-primary-400'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={() => { localStorage.removeItem('admin_token'); window.location.href = '/' }}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
