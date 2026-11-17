/**
 * Design Direction — Coastal Lagoon Theme
 *
 * Product: Trippie is a vacation planner that sequences sights, restaurants, day trips,
 * and photography windows around real transit times, powered by conversational AI and live sync.
 * Palette: Deep tropical lagoon teal canvas (#033D40 → #096C6E) contrasted with crisp pure-white
 * floating destination cards, solid + hollow-outlined display typography, and emerald-aqua accents.
 * Static Contract: Zero /api/auth/ requests and zero WebSockets on `/`.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Compass,
  MapPin,
  Play,
  Route,
  Search,
  Sparkles,
  User,
  Users,
} from 'lucide-react'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const HERO_CARDS = [
  {
    image: '/images/card-coast.jpg',
    title: 'Kyoto & Coastal Dawn Route',
    subtitle: 'Day 01 · −38 min transit · Golden-hour photo pins & walk-optimized temple loop.',
    cta: 'Open Atlas',
    to: '/home',
  },
  {
    image: '/images/card-lagoon.jpg',
    title: 'Iberia Broad Overview',
    subtitle: '10 Days · Suggested stay allocations across Lisbon, Porto & Seville before locking dates.',
    cta: 'Overview Mode',
    to: '/overview',
  },
  {
    image: '/images/card-forest.jpg',
    title: 'Collaborative Live Rooms',
    subtitle: 'Invite companions as Read-Only Viewers or Co-Editors with instant cloud sync.',
    cta: 'Start a Trip',
    to: '/trips/new',
  },
] as const

export default function Landing() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')

  function handleQuickSearch(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = searchQuery.trim()
    navigate(trimmed ? `/overview?q=${encodeURIComponent(trimmed)}` : '/overview')
  }

  return (
    <>
      <Seo {...seo} path="/" />
      <div
        data-testid="static-landing"
        className="relative min-h-[100dvh] overflow-x-hidden bg-[#044649] text-white"
      >
        {/* Full-bleed Tropical Lagoon Hero Banner */}
        <section className="relative overflow-hidden border-b border-white/15">
          <img
            src="/images/hero-lagoon.jpg"
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
          />
          {/* Moody Deep Ocean-Teal Scrim */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(108deg, rgba(3, 52, 55, 0.94) 0%, rgba(5, 72, 76, 0.80) 48%, rgba(4, 54, 57, 0.48) 100%)',
            }}
          />

          {/* Decorative 4x4 Dot Grid (desktop) */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-[38%] top-28 hidden grid-cols-4 gap-2 opacity-55 lg:grid"
          >
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i} className="size-1.5 rounded-full bg-white" />
            ))}
          </div>

          {/* Top Navigation Bar */}
          <header className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 lg:px-10">
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-full bg-white text-[#044649] shadow-sm">
                  <Compass className="size-5" aria-hidden />
                </span>
                <span className="text-base font-bold tracking-tight text-white">{APP_NAME}</span>
              </Link>

              <nav className="hidden items-center gap-6 text-xs font-medium text-white/90 md:flex">
                <Link to="/home" className="transition-colors hover:text-[#5eead4]">
                  Sample Atlas
                </Link>
                <Link to="/overview" className="transition-colors hover:text-[#5eead4]">
                  Overview Mode
                </Link>
                <Link to="/trips/new" className="transition-colors hover:text-[#5eead4]">
                  Plan a Trip
                </Link>
              </nav>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3">
              {/* Crisp White Pill Search (Desktop) */}
              <form
                onSubmit={handleQuickSearch}
                className="hidden items-center rounded-full bg-white/95 pl-3.5 pr-1.5 py-1 text-[#044649] shadow-sm lg:flex"
              >
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Destination..."
                  aria-label="Search destination"
                  className="w-36 bg-transparent text-xs text-[#044649] placeholder:text-[#044649]/60 outline-none"
                />
                <button
                  type="submit"
                  aria-label="Search destination"
                  className="flex size-7 items-center justify-center rounded-full text-[#044649] transition-colors hover:bg-[#044649]/10"
                >
                  <Search className="size-3.5" aria-hidden />
                </button>
              </form>

              {/* Signature Rounded User / Launch Pill */}
              <Link
                to="/home"
                className="inline-flex min-h-[38px] items-center gap-2 rounded-full bg-[#064e52]/95 py-1 pl-1.5 pr-3.5 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-[#0a6b6f]"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-white text-[#044649]">
                  <User className="size-3.5" aria-hidden />
                </span>
                <span>Open App</span>
              </Link>
            </div>
          </header>

          {/* Hero Main Grid */}
          <main className="relative mx-auto max-w-7xl px-4 pb-12 pt-4 sm:px-6 sm:pb-16 sm:pt-8 lg:px-10 lg:pb-20 lg:pt-10">
            <div className="grid items-end gap-8 lg:grid-cols-12 lg:gap-10">
              {/* Left Rail + Headline Column */}
              <div className="flex gap-5 lg:col-span-5">
                {/* Signature Left Vertical Line + Icon Rail (Desktop) */}
                <div
                  aria-hidden
                  className="hidden flex-col items-center justify-between py-2 sm:flex"
                >
                  <div className="h-32 w-[2px] rounded-full bg-white/80" />
                  <div className="mt-8 flex flex-col items-center gap-3 text-white/80">
                    <Compass className="size-4" />
                    <MapPin className="size-4" />
                    <Route className="size-4" />
                    <Sparkles className="size-4" />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#5eead4]">
                    35.0116° N · 135.7681° E · AI Vacation Atlas
                  </p>

                  <h1 className="mt-3 text-3xl font-extrabold uppercase leading-[1.03] tracking-tight text-white sm:text-5xl lg:text-[3.15rem]">
                    <span className="block">{'Chart every hour, '}</span>
                    <span
                      className="mt-1 block text-transparent"
                      style={{ WebkitTextStroke: '1.5px rgba(255, 255, 255, 0.92)' }}
                    >
                      not just flights.
                    </span>
                  </h1>

                  <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85 sm:text-base">
                    Sequence sights, local restaurants, day trips, and golden-hour photography
                    windows around real transit times—steered by AI and shared live.
                  </p>

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <Link
                      to="/trips/new"
                      className="inline-flex min-h-[44px] items-center gap-2.5 rounded-md bg-[#0a6b6e] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white ring-1 ring-white/30 shadow-lg transition-all hover:bg-[#0d8286]"
                    >
                      <span>Start Planning</span>
                      <span className="flex size-5 items-center justify-center rounded-full bg-white text-[#044649]">
                        <Play className="size-2.5 fill-current" aria-hidden />
                      </span>
                    </Link>

                    <Link
                      to="/overview"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-white/30 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                    >
                      Overview Mode
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </div>

                  {/* Chevron Motif */}
                  <div
                    aria-hidden
                    className="mt-7 hidden select-none items-center gap-1 font-mono text-xs tracking-tight text-white/80 sm:flex"
                  >
                    <span>◄◄◄◄◄</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Signature Crisp White Cards (Horizontal snap on mobile, 3-up grid on sm+) */}
              <div className="lg:col-span-7">
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0">
                  {HERO_CARDS.map((card) => (
                    <article
                      key={card.title}
                      className="flex w-[76vw] max-w-[270px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-xl bg-white text-[#06383b] shadow-xl transition-transform duration-200 hover:-translate-y-1 sm:w-auto sm:max-w-none"
                    >
                      <div>
                        <div className="aspect-[16/11] w-full overflow-hidden bg-[#0a5b5e]">
                          <img
                            src={card.image}
                            alt={card.title}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="p-4">
                          <h2 className="text-sm font-bold leading-snug text-[#06383b]">
                            {card.title}
                          </h2>
                          <p className="mt-1.5 text-xs leading-relaxed text-[#3f6a6c]">
                            {card.subtitle}
                          </p>
                        </div>
                      </div>

                      <div className="px-4 pb-4">
                        <Link
                          to={card.to}
                          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md bg-[#096c6e] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#075355]"
                        >
                          <span>{card.cta}</span>
                          <ArrowRight className="size-3" aria-hidden />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </section>

        {/* Below-the-fold Feature Highlights */}
        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
          <div className="grid gap-6 md:grid-cols-12">
            <div className="rounded-2xl border border-white/15 bg-[#065256] p-6 shadow-lg md:col-span-7">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#5eead4]">
                <Route className="size-4" aria-hidden />
                <span>Broad Overview + Route Engine</span>
              </div>
              <h2 className="mt-3 text-xl font-bold text-white">
                Know how many days each destination actually earns.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/80">
                Test candidate cities and total travel days in Overview Mode to balance intercity
                transit drag, then expand into an anchor-aware daily schedule with one click.
              </p>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-white/15 bg-[#065256] p-6 shadow-lg md:col-span-5">
              <div>
                <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#5eead4]">
                  <Users className="size-4" aria-hidden />
                  <span>Viewer &amp; Editor Permissions</span>
                </div>
                <h2 className="mt-3 text-xl font-bold text-white">
                  Co-plan live without accidental edits.
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/80">
                  Invite companions as read-only viewers or full editors with real-time Durable
                  Object sync across desktop and mobile.
                </p>
              </div>
              <Link
                to="/home"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[#5eead4] hover:underline"
              >
                Explore the live sample trip
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/15 py-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-white/70 sm:px-6 lg:px-10">
            <span>{APP_NAME} · Built on DeepSpace</span>
            <Link to="/home" className="font-medium text-white hover:text-[#5eead4]">
              Launch Workspace
            </Link>
          </div>
        </footer>
      </div>
    </>
  )
}
