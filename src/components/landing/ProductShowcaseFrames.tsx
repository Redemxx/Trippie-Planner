import type { ReactNode } from 'react'
import { Camera, Clock, Compass, Lock, MapPin, Navigation, Route, Search, Sparkles, Users } from 'lucide-react'

function BrowserFrame({
  children,
  label = 'trippie-planner.app.space',
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[#d6d5d2] bg-white shadow-[0_12px_36px_rgba(0,0,0,0.06)]">
      {/* Browser chrome topbar */}
      <div className="flex items-center justify-between border-b border-[#d6d5d2] bg-[#e6e5e1] px-3.5 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#505050]" />
          <span className="size-2.5 rounded-full bg-[#8a8985]" />
          <span className="size-2.5 rounded-full bg-[#a8a7a2]" />
        </div>
        <div className="hidden rounded-[6px] bg-[#f5f4f0] px-3 py-0.5 text-[11px] font-medium text-[#505050] sm:block">
          {label}
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2 w-8 rounded-full bg-[#cfceca]" />
          <span className="h-2 w-5 rounded-full bg-[#131313]" />
        </div>
      </div>
      {children}
    </div>
  )
}

export function HeroProductFrame() {
  return (
    <BrowserFrame label="trippie-planner.app.space/trips/kyoto-autumn">
      <div className="grid bg-[#fafaf8] sm:grid-cols-12">
        {/* Left pane: Kyoto Day 01 stops */}
        <div className="border-b border-[#e5e4e0] p-4 sm:col-span-6 sm:border-b-0 sm:border-r">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[#111111]">Day 01 · Kyoto</span>
            <span className="rounded-[6px] bg-[#fff4cc] px-2 py-0.5 text-[11px] font-semibold text-[#5c4300]">
              −38 min transit
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {/* Stop 1 */}
            <div className="flex items-center gap-2.5 rounded-[8px] border border-[#e5e4e0] bg-white p-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#131313] text-[11px] font-semibold text-[#ffc61a]">
                1
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12.5px] font-semibold text-[#111111]">
                    Kiyomizu-dera Terrace
                  </p>
                  <span className="shrink-0 text-[11px] font-medium text-[#505050]">06:30</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#505050]">Sunrise · 60 min stay</p>
              </div>
            </div>

            <div className="ml-4 flex items-center gap-1.5 border-l-2 border-dashed border-[#ffc61a] py-0.5 pl-3 text-[11px] text-[#505050]">
              <Clock className="size-3 text-[#b38600]" aria-hidden />
              <span>12 min walk · 0.9 km</span>
            </div>

            {/* Stop 2 */}
            <div className="flex items-center gap-2.5 rounded-[8px] border border-[#e5e4e0] bg-white p-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#131313] text-[11px] font-semibold text-[#ffc61a]">
                2
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12.5px] font-semibold text-[#111111]">
                    Yasaka Pagoda Lane
                  </p>
                  <span className="shrink-0 text-[11px] font-medium text-[#505050]">07:45</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#505050]">Must-See · Artisan coffee stop</p>
              </div>
            </div>

            <div className="ml-4 flex items-center gap-1.5 border-l-2 border-dashed border-[#ffc61a] py-0.5 pl-3 text-[11px] text-[#505050]">
              <Clock className="size-3 text-[#b38600]" aria-hidden />
              <span>18 min rail · 5.4 km</span>
            </div>

            {/* Stop 3 */}
            <div className="rounded-[8px] border border-[#f5d565] bg-[#fffdf4] p-2.5">
              <div className="flex items-center gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#ffc61a] text-[11px] font-bold text-[#131313]">
                  3
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12.5px] font-semibold text-[#111111]">
                      Fushimi Inari Ridge
                    </p>
                    <span className="shrink-0 text-[11px] font-medium text-[#505050]">17:15</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#ffc61a] px-1.5 py-0.5 text-[10px] font-semibold text-[#131313]">
                      <Camera className="size-2.5" aria-hidden />
                      Golden Hour
                    </span>
                    <span className="text-[11px] text-[#505050]">90 min climb</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right pane: Full-color Kyoto cartographic canvas */}
        <div className="relative flex min-h-[320px] flex-col overflow-hidden bg-[#eef3ea] p-3.5 sm:col-span-6">
          {/* Map top search bar */}
          <div className="relative z-10 flex items-center justify-between rounded-[6px] border border-[#d6d5d2] bg-white/95 px-2.5 py-1.5 shadow-xs">
            <span className="flex items-center gap-1.5 text-[11px] text-[#505050]">
              <Search className="size-3" aria-hidden />
              Kyoto · Higashiyama
            </span>
            <span className="rounded bg-[#edf5ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#1b5e20]">
              Live tiles
            </span>
          </div>

          {/* Color vector map background */}
          <svg
            viewBox="0 0 320 260"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
            className="mt-2.5 h-[280px] w-full flex-1 rounded-[6px] border border-[#d6dfd0] bg-[#f3f4ee]"
          >
            {/* Parks & foothills */}
            <path d="M210,0 L320,0 L320,260 L235,260 Q218,160 210,0 Z" fill="#cce3c4" />
            <rect x="20" y="18" width="56" height="44" rx="6" fill="#d7ead0" />
            <rect x="92" y="165" width="48" height="34" rx="5" fill="#d7ead0" />

            {/* Urban grid blocks */}
            <g stroke="#e0e2dc" strokeWidth="1.2" fill="none">
              <path d="M0,55 L220,55 M0,105 L225,105 M0,155 L235,155 M0,205 L240,205" />
              <path d="M50,0 L50,260 M105,0 L105,260 M160,0 L160,260" />
            </g>

            {/* Kamo River */}
            <path
              d="M142,0 C138,70 156,125 144,185 C135,222 126,245 118,260"
              fill="none"
              stroke="#89c9f0"
              strokeWidth="12"
              strokeLinecap="round"
            />

            {/* Golden optimized route path */}
            <path
              d="M238,76 C210,82 195,98 208,128 C185,158 148,186 128,218"
              fill="none"
              stroke="#ffc61a"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M238,76 C210,82 195,98 208,128 C185,158 148,186 128,218"
              fill="none"
              stroke="#131313"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />

            {/* City label */}
            <rect x="64" y="120" width="52" height="20" rx="4" fill="#ffffff" fillOpacity="0.92" />
            <text x="90" y="134" textAnchor="middle" fontSize="10" fontWeight="600" fill="#111111">
              Kyoto
            </text>

            {/* Numbered route pins */}
            <g transform="translate(238 76)">
              <circle r="11" fill="#131313" stroke="#ffc61a" strokeWidth="2.5" />
              <text y="3.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffc61a">
                1
              </text>
            </g>
            <g transform="translate(208 128)">
              <circle r="11" fill="#131313" stroke="#ffc61a" strokeWidth="2.5" />
              <text y="3.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffc61a">
                2
              </text>
            </g>
            <g transform="translate(128 218)">
              <circle r="12" fill="#ffc61a" stroke="#131313" strokeWidth="2.5" />
              <text y="4" textAnchor="middle" fontSize="10" fontWeight="700" fill="#131313">
                3
              </text>
            </g>
          </svg>
        </div>
      </div>
    </BrowserFrame>
  )
}

export function RouteEngineFrame() {
  return (
    <BrowserFrame label="trippie-planner.app.space/route-engine">
      <div className="space-y-4 bg-[#f8fafc] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#505050]">
              Anchor-Aware 2-Opt Optimizer
            </p>
            <p className="text-[15px] font-semibold text-[#111111]">
              Sequence around sunrise &amp; dinner reservations
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#ffc61a] px-2.5 py-1 text-[11px] font-bold text-[#131313]">
            <Route className="size-3.5" aria-hidden />
            38 min saved
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-3.5">
            <p className="text-[11px] font-semibold text-[#64748b]">Unordered wish list</p>
            <p className="mt-1 text-[20px] font-semibold text-[#111111]">94 min transit</p>
            <div className="mt-3 space-y-1.5 text-[11px] text-[#505050]">
              <div className="flex justify-between rounded bg-[#fee2e2] px-2 py-1 text-[#991b1b]">
                <span>Cross-town detour</span>
                <span>42 min</span>
              </div>
              <div className="flex justify-between rounded bg-[#f1f5f9] px-2 py-1">
                <span>Late arrival at viewpoint</span>
                <span>After sunset</span>
              </div>
            </div>
          </div>

          <div className="rounded-[8px] border border-[#facc15] bg-[#fffbeb] p-3.5">
            <p className="text-[11px] font-semibold text-[#854d0e]">Optimized sequence</p>
            <p className="mt-1 text-[20px] font-semibold text-[#111111]">56 min transit</p>
            <div className="mt-3 space-y-1.5 text-[11px] text-[#373737]">
              <div className="flex justify-between rounded bg-white px-2 py-1 font-medium">
                <span>Morning walk cluster</span>
                <span className="text-[#15803d]">12 min</span>
              </div>
              <div className="flex justify-between rounded bg-[#ffc61a]/35 px-2 py-1 font-medium text-[#131313]">
                <span>Ridge pinned to Golden Hour</span>
                <span>17:15</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}

export function OverviewPacingFrame() {
  const cities = [
    { name: 'Lisbon', days: '4 days', transit: 'Base camp', color: '#2563eb', pct: '40%' },
    { name: 'Porto', days: '3 days', transit: '3h rail', color: '#0d9488', pct: '30%' },
    { name: 'Seville', days: '3 days', transit: '5.5h transfer', color: '#ffc61a', pct: '30%' },
  ]
  return (
    <BrowserFrame label="trippie-planner.app.space/overview">
      <div className="space-y-4 bg-[#f8fafc] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-[#505050]">Broad Overview Mode · 10 Days</p>
            <p className="text-[15px] font-semibold text-[#111111]">Iberia Rail Blueprint</p>
          </div>
          <span className="rounded-[6px] bg-[#dcfce7] px-2.5 py-1 text-[11px] font-semibold text-[#166534]">
            Feasibility 86 / 100 · Comfortable
          </span>
        </div>

        {/* Allocation strip */}
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
          {cities.map((c) => (
            <div key={c.name} style={{ width: c.pct, backgroundColor: c.color }} />
          ))}
        </div>

        <div className="space-y-2">
          {cities.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between rounded-[8px] border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-[12px]"
            >
              <div className="flex items-center gap-2.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="font-semibold text-[#111111]">{c.name}</span>
                <span className="text-[#505050]">{c.transit}</span>
              </div>
              <span className="rounded bg-[#f1f5f9] px-2 py-0.5 font-semibold text-[#111111]">
                {c.days}
              </span>
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  )
}

export function CollaborationConciergeFrame() {
  return (
    <BrowserFrame label="trippie-planner.app.space/trips/shared-room">
      <div className="grid gap-3 bg-[#f8fafc] p-5 sm:grid-cols-12">
        {/* Roles & Sync */}
        <div className="space-y-2.5 sm:col-span-5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#111111]">
            <Users className="size-3.5 text-[#0f766e]" aria-hidden />
            Trip Access Roles
          </div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2">
              <span className="font-medium text-[#111111]">Maya (You)</span>
              <span className="rounded bg-[#131313] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                Owner
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2">
              <span className="font-medium text-[#111111]">Daniel</span>
              <span className="rounded bg-[#dbeafe] px-1.5 py-0.5 text-[10px] font-semibold text-[#1e40af]">
                Editor
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2">
              <span className="flex items-center gap-1 font-medium text-[#111111]">
                <Lock className="size-2.5 text-[#505050]" aria-hidden />
                Claire
              </span>
              <span className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569]">
                Viewer
              </span>
            </div>
          </div>
        </div>

        {/* AI Concierge thread */}
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-3 sm:col-span-7">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#111111]">
            <Sparkles className="size-3.5 text-[#b38600]" aria-hidden />
            AI Concierge
          </div>
          <div className="mt-2.5 space-y-2 text-[11px]">
            <div className="rounded-[6px] bg-[#f1f5f9] px-2.5 py-1.5 text-[#373737]">
              “Add a sunset viewpoint near Alfama and rebalance walking legs.”
            </div>
            <div className="rounded-[6px] border border-[#fde68a] bg-[#fffbeb] px-2.5 py-2 text-[#111111]">
              <span className="font-semibold">Added Miradouro da Graça (18:10)</span> — 8 min walk
              from dinner, saves 22 min uphill backtrack.
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}

export function EditorialAvatar({
  initials,
  bg,
  label,
}: {
  initials: string
  bg: string
  label: string
}) {
  return (
    <span
      aria-label={label}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-[#f5f4f0] text-[11px] font-semibold text-[#fcfcfd]"
      style={{ backgroundColor: bg }}
    >
      {initials}
    </span>
  )
}

export function PartnerClubMarks() {
  const clubs = [
    { name: 'Halvorsen Field', Icon: Compass },
    { name: 'Brightcoast', Icon: Navigation },
    { name: 'Mossgate Rail', Icon: Route },
    { name: 'Tarnwell Co.', Icon: MapPin },
    { name: 'Quarrystone', Icon: Camera },
    { name: 'Pellucid', Icon: Users },
  ]
  return (
    <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
      {clubs.map(({ name, Icon }) => (
        <div
          key={name}
          className="flex items-center justify-center gap-2 text-[14px] font-medium text-[#373737]"
        >
          <Icon className="size-4 text-[#505050]" aria-hidden />
          <span>{name}</span>
        </div>
      ))}
    </div>
  )
}
