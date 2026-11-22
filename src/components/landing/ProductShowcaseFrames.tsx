import type { ReactNode } from 'react'
import { Camera, Clock, Lock, Route, Search, Sparkles, Users } from 'lucide-react'

function BrowserFrame({
  children,
  label = 'trippie-planner.app.space',
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[#d6d5d2] bg-white shadow-[0_12px_36px_rgba(0,0,0,0.06)]">
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
        <div className="border-b border-[#e5e4e0] p-4 sm:col-span-6 sm:border-b-0 sm:border-r">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[#111111]">Fri, Nov 20 · Kyoto</span>
            <span className="rounded-[4px] bg-[#fff4cc] px-2 py-0.5 text-[11px] font-semibold text-[#5c4300]">
              Base: Higashiyama Inn
            </span>
          </div>

          <div className="mt-4 space-y-3">
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
                <p className="mt-0.5 text-[11px] text-[#505050]">Sunrise · 14 min from hotel</p>
              </div>
            </div>

            <div className="ml-4 flex items-center gap-1.5 border-l-2 border-dashed border-[#ffc61a] py-0.5 pl-3 text-[11px] text-[#505050]">
              <Clock className="size-3 text-[#b38600]" aria-hidden />
              <span>12 min walk · 0.9 km</span>
            </div>

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

        <div className="relative flex min-h-[300px] flex-col overflow-hidden bg-[#eef3ea] p-3.5 sm:col-span-6">
          <div className="relative z-10 flex items-center justify-between rounded-[6px] border border-[#d6d5d2] bg-white/95 px-2.5 py-1.5 shadow-xs">
            <span className="flex items-center gap-1.5 text-[11px] text-[#505050]">
              <Search className="size-3" aria-hidden />
              Kyoto · Higashiyama
            </span>
            <span className="rounded bg-[#edf5ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#1b5e20]">
              OSM Atlas
            </span>
          </div>

          <svg
            viewBox="0 0 320 260"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
            className="mt-2.5 h-[265px] w-full flex-1 rounded-[6px] border border-[#d6dfd0] bg-[#f3f4ee]"
          >
            <path d="M210,0 L320,0 L320,260 L235,260 Q218,160 210,0 Z" fill="#cce3c4" />
            <rect x="20" y="18" width="56" height="44" rx="6" fill="#d7ead0" />
            <rect x="92" y="165" width="48" height="34" rx="5" fill="#d7ead0" />
            <g stroke="#e0e2dc" strokeWidth="1.2" fill="none">
              <path d="M0,55 L220,55 M0,105 L225,105 M0,155 L235,155 M0,205 L240,205" />
              <path d="M50,0 L50,260 M105,0 L105,260 M160,0 L160,260" />
            </g>
            <path
              d="M142,0 C138,70 156,125 144,185 C135,222 126,245 118,260"
              fill="none"
              stroke="#89c9f0"
              strokeWidth="12"
              strokeLinecap="round"
            />
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
            <rect x="64" y="120" width="52" height="20" rx="4" fill="#ffffff" fillOpacity="0.92" />
            <text x="90" y="134" textAnchor="middle" fontSize="10" fontWeight="600" fill="#111111">
              Kyoto
            </text>
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
    <BrowserFrame label="trippie-planner.app.space/trips/moving-day">
      <div className="space-y-3 bg-[#f8fafc] p-5 text-[12px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#505050]">
              Hotel Check-Out, Intercity Travel &amp; Check-In
            </p>
            <p className="text-[15px] font-semibold text-[#111111]">
              Sun, Nov 22 · Kyoto → Hakone Moving Day
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#ffc61a] px-2 py-0.5 text-[11px] font-bold text-[#131313]">
            <Route className="size-3.5" aria-hidden />
            Hotel change
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2">
            <span className="font-medium text-[#111111]">10:00 · Check out: Higashiyama Inn</span>
            <span className="text-[#505050]">Lodging</span>
          </div>
          <div className="flex items-center justify-between rounded-[6px] border border-[#fde68a] bg-[#fffbeb] px-3 py-2">
            <span className="font-medium text-[#111111]">10:25 · Travel: Kyoto → Hakone</span>
            <span className="text-[#854d0e]">~2.5h Shinkansen</span>
          </div>
          <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2">
            <span className="font-medium text-[#111111]">15:00 · Check in: Gora Ryokan</span>
            <span className="text-[#505050]">Base lodging</span>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}

export function CollaborationConciergeFrame() {
  return (
    <BrowserFrame label="trippie-planner.app.space/trips/shared-room">
      <div className="grid gap-3 bg-[#f8fafc] p-5 sm:grid-cols-12">
        <div className="space-y-2 sm:col-span-5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#111111]">
            <Users className="size-3.5 text-[#0f766e]" aria-hidden />
            Trip Access Roles
          </div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2">
              <span className="font-medium text-[#111111]">Owner</span>
              <span className="text-[#505050]">Full control</span>
            </div>
            <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2">
              <span className="font-medium text-[#111111]">Editor</span>
              <span className="text-[#1e40af]">Live co-edit</span>
            </div>
            <div className="flex items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2">
              <span className="flex items-center gap-1 font-medium text-[#111111]">
                <Lock className="size-2.5 text-[#505050]" aria-hidden />
                Viewer
              </span>
              <span className="text-[#475569]">Read-only</span>
            </div>
          </div>
        </div>

        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-3 sm:col-span-7">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#111111]">
            <Sparkles className="size-3.5 text-[#b38600]" aria-hidden />
            AI Concierge
          </div>
          <div className="mt-2.5 space-y-2 text-[11px]">
            <div className="rounded-[6px] bg-[#f1f5f9] px-2.5 py-1.5 text-[#373737]">
              “Fill Saturday around Alfama and include a nearby sunset viewpoint.”
            </div>
            <div className="rounded-[6px] border border-[#fde68a] bg-[#fffbeb] px-2.5 py-2 text-[#111111]">
              <span className="font-semibold">Auto-added Miradouro da Graça (18:10)</span> — 8 min
              walk from dinner, sequenced after nearby sights.
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}
