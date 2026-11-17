import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Archive, Boxes, ClipboardCheck, CirclePlus, FileSpreadsheet, FolderTree, Inbox, LogIn, LogOut, Menu, MessagesSquare,
  PackagePlus, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Users, X, type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { backend, isDemo } from '../backend'
import { useCatalog, useRequests, useStaff, useUser } from '../hooks/data'
import { resetDemo } from '../backend/demo'
import { usePosts } from '../pages/Community'
import { CATALOG_ONLY, RELEASE } from '../lib/release'

export function Logo({ size = 36 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}hatchery-logo.svg`} alt="" width={size} height={size} className="rounded-[10px] shadow-sm" />
}

const COLLAPSE_KEY = 'hatchery-sidebar-collapsed'
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

interface Item {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: number
}

function NavItem({ item, collapsed, onNavigate }: { item: Item; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        clsx(
          'group relative flex min-h-11 items-center gap-3 rounded-xl text-[0.95rem] font-medium transition-colors focus-visible:!outline-gold-light',
          collapsed ? 'justify-center px-0' : 'px-3',
          isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/6 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-full bg-gold-light" />}
          <Icon className={clsx('h-5 w-5 shrink-0', isActive ? 'text-gold-light' : '')} aria-hidden />
          <span className={collapsed ? 'sr-only' : 'flex-1 truncate'}>{item.label}</span>
          {item.badge ? (
            <span
              className={clsx(
                'rounded-full bg-gold-light px-1.5 text-xs font-bold leading-5 text-maroon-deep',
                collapsed && 'absolute right-2 top-1.5 min-w-5 text-center leading-5',
              )}
            >
              {item.badge}
              <span className="sr-only"> open</span>
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  )
}

function SidebarContent({ collapsed, onNavigate, onToggle, mobile }: { collapsed: boolean; onNavigate?: () => void; onToggle?: () => void; mobile?: boolean }) {
  const { data: staff } = useStaff()
  const { data: user } = useUser()
  const requests = useRequests(Boolean(staff))
  const openCount = requests.data?.filter((r) => r.status === 'open').length ?? 0
  const catalog = useCatalog()
  const toReview = staff ? catalog.data?.parts.filter((p) => p.reviewStatus === 'needs_review').length ?? 0 : 0
  const posts = usePosts()
  const pendingPosts = staff ? posts.data?.filter((p) => p.status === 'pending').length ?? 0 : 0
  const navigate = useNavigate()

  const findItems: Item[] = [
    { to: '/', label: 'Search', icon: Search, end: true },
    { to: '/locations', label: 'Drawers', icon: Archive },
    ...(CATALOG_ONLY ? [] : [
      { to: '/community', label: 'Community', icon: MessagesSquare },
      { to: '/request', label: 'Request a part', icon: PackagePlus },
    ]),
  ]
  const staffItems: Item[] = [
    { to: '/admin/review', label: 'Inventory review', icon: ClipboardCheck, badge: toReview },
    { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
    { to: '/admin/parts/new', label: 'Add a part', icon: CirclePlus },
    { to: '/admin/requests', label: 'Restock requests', icon: Inbox, badge: openCount },
    { to: '/admin/locations', label: 'Locations', icon: FolderTree },
    { to: '/admin/community', label: 'Moderation', icon: ShieldCheck, badge: pendingPosts },
    { to: '/admin/import', label: 'CSV import/export', icon: FileSpreadsheet },
    ...(staff?.role === 'admin' ? [{ to: '/admin/people', label: 'People', icon: Users }] : []),
  ]

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-maroon-deep via-maroon-dark to-maroon-deep px-3 pb-4 pt-4 text-white">
      <div className={clsx('flex items-center gap-3', collapsed ? 'flex-col' : 'px-1')}>
        <Link to="/" onClick={onNavigate} className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:!outline-gold-light" aria-label="Hatchery Electronics Library, home">
          <Logo size={40} />
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block text-[1.05rem] font-extrabold tracking-tight">Hatchery</span>
              <span className="block truncate text-xs text-gold-light">Electronics Library</span>
            </span>
          )}
        </Link>
        {onToggle && (
          <button
            onClick={onToggle}
            className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white focus-visible:!outline-gold-light', !collapsed && 'ml-auto')}
            aria-label={mobile ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={mobile ? true : !collapsed}
          >
            {mobile ? <X className="h-5 w-5" /> : collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        )}
      </div>

      <nav aria-label="Main" className="no-scrollbar mt-6 flex-1 space-y-6 overflow-y-auto">
        <div>
          {!collapsed && <p className="mb-2 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-white/45">Find parts</p>}
          <div className="space-y-1">{findItems.map((i) => <NavItem key={i.to} item={i} collapsed={collapsed} onNavigate={onNavigate} />)}</div>
        </div>
        {staff && (
          <div>
            {!collapsed ? (
              <p className="mb-2 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-white/45">Admin</p>
            ) : (
              <div className="mx-3 mb-3 border-t border-white/10" />
            )}
            <div className="space-y-1">{staffItems.map((i) => <NavItem key={i.to} item={i} collapsed={collapsed} onNavigate={onNavigate} />)}</div>
          </div>
        )}
      </nav>

      <div className="mt-4 space-y-2">
        {user ? (
          <div className={clsx('flex items-center gap-2 rounded-xl bg-white/6', collapsed ? 'flex-col p-1.5' : 'p-2 pl-2')}>
            <Link
              to="/account"
              onClick={onNavigate}
              title={collapsed ? `${user.email} — account` : undefined}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 hover:bg-white/6 focus-visible:!outline-gold-light"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-light text-sm font-bold uppercase text-maroon-deep" aria-hidden>
                {(user.displayName || user.email)[0]}
              </span>
              <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1'}>
                <span className="block truncate text-sm font-semibold">{user.displayName || user.email}</span>
                <span className="block truncate text-xs text-white/55">
                  {user.role === 'member' ? user.email : user.role === 'admin' ? 'Admin' : 'Staff'}
                </span>
              </span>
            </Link>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white focus-visible:!outline-gold-light"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                await backend.signOut()
                onNavigate?.()
                navigate('/')
              }}
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        ) : CATALOG_ONLY ? null : (
          <NavItem item={{ to: '/signin', label: 'Sign in', icon: LogIn }} collapsed={collapsed} onNavigate={onNavigate} />
        )}
        {CATALOG_ONLY && !collapsed && (
          <p className="px-3 text-[0.7rem] leading-snug text-gold-light">v{RELEASE.version} · {RELEASE.name}</p>
        )}
        {!collapsed && <p className="px-3 text-[0.7rem] leading-snug text-white/40">Hatchery Makerspaces · Boston College</p>}
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: staff } = useStaff()
  const catalog = useCatalog()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const qc = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // ignore
      }
      return !c
    })

  // Mobile drawer: Esc closes, focus moves in and back out.
  useEffect(() => {
    if (!mobileOpen) return
    drawerRef.current?.querySelector<HTMLElement>('a,button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false)
    window.addEventListener('keydown', onKey)
    const btn = menuBtnRef.current
    return () => {
      window.removeEventListener('keydown', onKey)
      btn?.focus()
    }
  }, [mobileOpen])

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 md:block',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={toggle} />
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-2.5 backdrop-blur-md md:hidden">
        <button
          ref={menuBtnRef}
          onClick={() => setMobileOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-2 hover:bg-maroon-tint hover:text-maroon"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/" className="flex items-center gap-2.5 rounded-xl" aria-label="Hatchery Electronics Library, home">
          <Logo size={32} />
          <span className="leading-tight">
            <span className="block text-[0.95rem] font-extrabold tracking-tight">Hatchery</span>
            <span className="block text-[0.7rem] text-ink-3">Electronics Library</span>
          </span>
        </Link>
        {location.pathname !== '/' && (
          <Link to="/" className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl text-ink-2 hover:bg-maroon-tint hover:text-maroon" aria-label="Search">
            <Search className="h-5 w-5" />
          </Link>
        )}
      </header>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" aria-label="Close menu" tabIndex={-1} onClick={() => setMobileOpen(false)} />
          <div ref={drawerRef} className="absolute inset-y-0 left-0 w-[82%] max-w-72 shadow-2xl">
            <SidebarContent collapsed={false} mobile onToggle={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className={clsx('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'md:pl-[76px]' : 'md:pl-64')}>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-5 sm:px-6 md:pt-8">
          {CATALOG_ONLY && (
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-gold-light bg-gold-tint px-4 py-2.5 text-sm text-gold-dark">
              <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">v{RELEASE.version}</span>
              <span>
                {RELEASE.name} preview. Parts were cataloged from photos of the drawers on 2026-11-16 and are still being verified by staff — check the drawer before relying on a listing.
              </span>
            </div>
          )}
          {isDemo && !CATALOG_ONLY && (
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-gold-light bg-gold-tint px-4 py-2.5 text-sm text-gold-dark">
              <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">Demo</span>
              <span>
                {catalog.data?.parts.some((p) => p.evidence)
                  ? 'Local preview: catalog from the 2026-11-16 drawer photos. Changes stay in this browser until the database is connected.'
                  : 'Parts and drawers here are made-up examples, not the Hatchery’s inventory.'}
              </span>
              {staff && (
                <button
                  className="font-semibold underline underline-offset-2"
                  onClick={() => {
                    if (confirm('Reset the demo data in this browser?')) {
                      resetDemo()
                      qc.invalidateQueries()
                    }
                  }}
                >
                  Reset demo data
                </button>
              )}
            </div>
          )}
          {children}
        </main>
        <footer className="px-6 py-5 text-center text-xs text-ink-3">
          {CATALOG_ONLY ? 'Can’t find something? Ask staff at the Hatchery electronics desk.' : 'Missing something? Tap “Request restock” on a part, or ask staff at the desk.'}
        </footer>
      </div>
    </div>
  )
}
