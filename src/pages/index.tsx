/**
 * Minimal editorial landing page (`/`) for Trippie.
 *
 * Keeps only factual application capabilities and routes (`/home`, `/trips/new`, `/settings`)
 * with zero fabricated metrics, customer usage claims, logos, testimonials, or pricing plans.
 * Static contract: zero `/api/auth/` requests and zero `/ws/` WebSockets on `/`.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Compass, Menu, X } from 'lucide-react'
import { Seo } from '../components/Seo'
import {
  CollaborationConciergeFrame,
  HeroProductFrame,
  RouteEngineFrame,
} from '../components/landing/ProductShowcaseFrames'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const NAV_LINKS = [
  { label: 'Capabilities', href: '#features' },
  { label: 'How it works', href: '#process' },
  { label: 'Atlas Home', href: '/home', isRoute: true },
] as const

const FEATURE_ROWS = [
  {
    title: 'Hotels, transit legs & date-based days',
    description:
      'Set where you are staying per destination with configurable check-out (default 10:00) and check-in (default 15:00) times. Trippie estimates morning departure times from your lodging and inserts moving-day travel blocks directly into the schedule.',
    cta: 'Plan a dated trip',
    to: '/trips/new',
    media: <RouteEngineFrame />,
    imageFirst: true,
  },
  {
    title: 'AI Concierge & Viewer/Editor rooms',
    description:
      'Steer days conversationally—automatically pairing nearby photography viewpoints when filling a schedule—and invite companions as read-only Viewers or live Editors.',
    cta: 'Preview workspace',
    to: '/home',
    media: <CollaborationConciergeFrame />,
    imageFirst: false,
  },
] as const

const PROCESS_STEPS = [
  {
    num: '1',
    title: 'Set destinations, dates & stays',
    description:
      'Enter city dates, hotel locations, and check-in/out times so each day anchors around where you stay.',
  },
  {
    num: '2',
    title: 'Sequence stops around real transit',
    description:
      'Optimize daily ordering between landmarks, dining, hotel transfers, and nearby photography viewpoints auto-included by the assistant.',
  },
  {
    num: '3',
    title: 'Follow live on the road & share roles',
    description:
      'During active trip dates, follow today’s progressing schedule with weather for the day’s locations, while sharing Viewer or Editor links.',
  },
] as const

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <>
      <Seo {...seo} path="/" />
      <div
        data-testid="static-landing"
        className="font-editorial-body min-h-[100dvh] bg-[#f5f4f0] text-[#000000] antialiased"
      >
        {/* Site Header */}
        <header className="bg-[#f5f4f0]">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-6 py-5">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-[8px] bg-[#131313] text-[#fcfcfd]">
                <Compass className="size-4" aria-hidden />
              </span>
              <span className="font-editorial-display text-[22px] font-medium tracking-tight text-[#000000]">
                {APP_NAME}
              </span>
            </Link>

            <nav aria-label="Primary navigation" className="hidden items-center gap-7 md:flex">
              {NAV_LINKS.map((item) =>
                'isRoute' in item && item.isRoute ? (
                  <Link
                    key={item.label}
                    to={item.href}
                    className="text-[15px] font-normal text-[#373737] transition-colors hover:text-[#000000]"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <a
                    key={item.label}
                    href={item.href}
                    className="text-[15px] font-normal text-[#373737] transition-colors hover:text-[#000000]"
                  >
                    {item.label}
                  </a>
                ),
              )}
            </nav>

            <div className="hidden items-center gap-4 md:flex">
              <Link
                to="/home"
                className="text-[15px] font-medium text-[#373737] transition-colors hover:text-[#000000]"
              >
                Preview atlas
              </Link>
              <Link
                to="/trips/new"
                className="inline-flex h-10 items-center justify-center rounded-[8px] bg-[#131313] px-4 text-[14px] font-medium text-[#fcfcfd] transition-opacity hover:opacity-90"
              >
                Start a trip
              </Link>
            </div>

            <button
              type="button"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex size-10 items-center justify-center rounded-[8px] border border-[#d6d5d2] text-[#000000] md:hidden"
            >
              {mobileMenuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="border-t border-[#d6d5d2] bg-[#f5f4f0] px-6 py-4 md:hidden">
              <div className="flex flex-col gap-3">
                {NAV_LINKS.map((item) =>
                  'isRoute' in item && item.isRoute ? (
                    <Link
                      key={item.label}
                      to={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="py-1.5 text-[16px] text-[#373737]"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <a
                      key={item.label}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="py-1.5 text-[16px] text-[#373737]"
                    >
                      {item.label}
                    </a>
                  ),
                )}
                <div className="mt-2 flex flex-col gap-2 border-t border-[#d6d5d2] pt-3">
                  <Link
                    to="/home"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[#d6d5d2] text-[15px] font-medium text-[#000000]"
                  >
                    Preview atlas
                  </Link>
                  <Link
                    to="/trips/new"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex h-11 items-center justify-center rounded-[8px] bg-[#131313] text-[15px] font-medium text-[#fcfcfd]"
                  >
                    Start a trip
                  </Link>
                </div>
              </div>
            </div>
          )}
        </header>

        {/* Hero */}
        <section className="bg-[#ecebe8] pb-[64px] pt-[72px] md:pb-[85px] md:pt-[112px]">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-6">
              <h1 className="font-editorial-display text-[56px] font-medium leading-[1.03] tracking-[-0.025em] text-[#000000] sm:text-[64px] md:text-[83px]">
                Chart every hour, not just flights.
              </h1>

              <p className="mt-6 max-w-[34rem] text-[16px] leading-[1.55] text-[#373737]">
                Trippie organizes your cities, hotels, transit legs, restaurants, and golden-hour
                photo stops into date-by-date schedules—steered by conversational AI and shared live.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  to="/trips/new"
                  className="inline-flex h-11 items-center justify-center rounded-[8px] bg-[#131313] px-5 text-[15px] font-medium text-[#fcfcfd] transition-opacity hover:opacity-90"
                >
                  Start a trip
                </Link>
                <Link
                  to="/home"
                  className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[#d6d5d2] bg-transparent px-5 text-[15px] font-medium text-[#000000] transition-colors hover:bg-[#e2e0dc]"
                >
                  Preview atlas
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <HeroProductFrame />
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section id="features" className="bg-[#f5f4f0] pb-[64px] pt-[72px] md:pb-[85px] md:pt-[96px]">
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-editorial-display text-[36px] font-medium leading-[1.1] tracking-[-0.02em] text-[#000000] md:text-[50px]">
                Built for how trips actually unfold
              </h2>
              <p className="mt-4 text-[16px] leading-[1.55] text-[#373737]">
                Connect destinations, lodging check-in/out windows, and daily routes on one map
                without losing track of transit times.
              </p>
            </div>

            <div className="mt-14 space-y-16 md:mt-16 md:space-y-24">
              {FEATURE_ROWS.map((row) => (
                <div
                  key={row.title}
                  className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14"
                >
                  <div className={row.imageFirst ? 'lg:col-span-7' : 'lg:order-2 lg:col-span-7'}>
                    {row.media}
                  </div>
                  <div className={row.imageFirst ? 'lg:col-span-5' : 'lg:order-1 lg:col-span-5'}>
                    <h3 className="font-editorial-display text-[30px] font-medium leading-[1.14] tracking-[-0.02em] text-[#000000] md:text-[38px]">
                      {row.title}
                    </h3>
                    <p className="mt-3 text-[16px] leading-[1.6] text-[#373737]">
                      {row.description}
                    </p>
                    <Link
                      to={row.to}
                      className="mt-5 inline-flex items-center gap-1.5 text-[15px] font-medium text-[#000000] underline-offset-4 hover:underline"
                    >
                      <span>{row.cta}</span>
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="process" className="bg-[#ecebe8] pb-[64px] pt-[72px] md:pb-[85px] md:pt-[104px]">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-6 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="font-editorial-display text-[36px] font-medium leading-[1.1] tracking-[-0.02em] text-[#000000] md:text-[46px]">
                From rough wish list to timed itinerary
              </h2>
              <p className="mt-4 max-w-md text-[16px] leading-[1.55] text-[#373737]">
                Plot stays and travel days once, then use the workspace and AI Concierge from
                planning through every day on the trip.
              </p>
            </div>

            <div className="lg:col-span-7">
              <ol className="relative space-y-8">
                <div
                  aria-hidden
                  className="absolute bottom-6 left-4 top-6 w-px bg-[#d6d5d2]"
                />
                {PROCESS_STEPS.map((step) => (
                  <li key={step.num} className="relative flex items-start gap-5">
                    <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#131313] text-[13px] font-semibold text-[#fcfcfd]">
                      {step.num}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <h3 className="text-[18px] font-semibold text-[#000000]">{step.title}</h3>
                      <p className="mt-1.5 text-[15px] leading-[1.55] text-[#373737]">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Inverse Closing Banner */}
        <section className="bg-[#141314] py-[64px] text-[#fcfcfd] md:py-[80px]">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 px-6 md:flex-row md:items-center">
            <h2 className="font-editorial-display text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-[#fcfcfd] md:text-[46px]">
              Open the workspace and start mapping.
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/trips/new"
                className="inline-flex h-11 items-center justify-center rounded-[8px] bg-[#fcfcfd] px-5 text-[15px] font-medium text-[#141314] transition-opacity hover:opacity-90"
              >
                Start a trip
              </Link>
              <Link
                to="/home"
                className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[#fcfcfd]/25 bg-transparent px-5 text-[15px] font-medium text-[#fcfcfd] transition-colors hover:bg-white/10"
              >
                Open Atlas Home
              </Link>
            </div>
          </div>
        </section>

        {/* Compact Footer */}
        <footer className="bg-[#f5f4f0] py-8 text-[#505050]">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 text-[14px]">
            <span className="font-medium text-[#000000]">{APP_NAME} · Collaborative Vacation Planner</span>
            <div className="flex flex-wrap items-center gap-6">
              <Link to="/home" className="hover:text-[#000000]">
                Atlas
              </Link>
              <Link to="/trips/new" className="hover:text-[#000000]">
                New Trip
              </Link>
              <Link to="/settings" className="hover:text-[#000000]">
                Settings
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
