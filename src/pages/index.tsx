/**
 * Editorial landing page (`/`) — maps Trippie's features, routes, and static
 * contract onto the 10-section editorial design contract in `DESIGN.md`.
 *
 * Preserves:
 * - Routes: `/home`, `/overview`, `/trips/new`
 * - Static contract: zero `/api/auth/` requests and zero `/ws/` WebSockets on `/`
 * - `tests/smoke.spec.ts` hooks: `data-testid="static-landing"` and `<h1>` containing
 *   "Chart every hour, not just flights."
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Compass, Menu, Minus, Plus, X } from 'lucide-react'
import { Seo } from '../components/Seo'
import {
  CollaborationConciergeFrame,
  EditorialAvatar,
  HeroProductFrame,
  OverviewPacingFrame,
  PartnerClubMarks,
  RouteEngineFrame,
} from '../components/landing/ProductShowcaseFrames'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const NAV_LINKS = [
  { label: 'Atlas', href: '#features' },
  { label: 'Overview', href: '#process' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
] as const

const HERO_METRICS = [
  { value: '38m', line1: 'less daily', line2: 'transit' },
  { value: '4.9', line1: 'trip', line2: 'rating' },
  { value: '2 modes', line1: 'Overview &', line2: 'Detailed' },
  { value: 'Live', line1: 'co-editing', line2: 'sync' },
] as const

const FEATURE_ROWS = [
  {
    title: 'Travel-time route engine',
    description:
      'Plot sights, cafes, day trips, and photography spots around realistic walk, transit, and drive legs. Lock sunrise or dinner reservations as anchors while Trippie sequences every stop in between.',
    cta: 'Open sample route',
    to: '/home',
    media: <RouteEngineFrame />,
    imageFirst: true,
  },
  {
    title: 'Broad Overview & stay pacing',
    description:
      'Start in Overview Mode with candidate destinations and your available days to evaluate intercity transit drag and pacing before booking lodging, then expand directly into dated legs.',
    cta: 'Try Overview Mode',
    to: '/overview',
    media: <OverviewPacingFrame />,
    imageFirst: false,
  },
  {
    title: 'AI Concierge & Viewer/Editor sync',
    description:
      'Steer itineraries conversationally using built-in models or your own encrypted Google Gemini key, and invite companions as read-only Viewers or full Editors with live cloud sync.',
    cta: 'Start a collaborative trip',
    to: '/trips/new',
    media: <CollaborationConciergeFrame />,
    imageFirst: true,
  },
] as const

const PROCESS_STEPS = [
  {
    num: '1',
    title: 'Pick cities or start with Overview Mode',
    description:
      'Enter fixed dates per stop, or drop in a wish list of places to see how many days each city earns within your window.',
  },
  {
    num: '2',
    title: 'Optimize legs & golden-hour stops',
    description:
      'Add landmarks, local restaurants, and photo viewpoints, then optimize ordering to trim backtracking and catch the right light.',
  },
  {
    num: '3',
    title: 'Share live with Viewer or Editor access',
    description:
      'Invite travel partners with read-only links or editing rights so schedules, budgets, and checklists stay aligned in real time.',
  },
] as const

const SUPPORTING_QUOTES = [
  {
    quote:
      'Testing Portugal in Overview Mode first saved us from cramming four cities into seven days. Converting that blueprint into daily stops took one click.',
    author: 'Diego Marlow',
    role: 'Photographer & trip lead',
    initials: 'DM',
    bg: '#2b454e',
  },
  {
    quote:
      'Having read-only Viewer links for family members while my partner and I kept Editor access stopped accidental deletions before our Kyoto flight.',
    author: 'Ruth Achebe',
    role: 'Architect, Brightcoast',
    initials: 'RA',
    bg: '#4b3b2f',
  },
] as const

const PRICING_PLANS = [
  {
    name: 'Solo Explorer',
    price: '$0',
    unit: '/trip',
    summary: 'Plan detailed or broad-overview routes on your own with instant Markdown export.',
    cta: 'Start free',
    to: '/trips/new',
    recommended: false,
    features: [
      'Unlimited detailed & overview trips',
      'Anchor-aware transit optimizer',
      'Golden-hour & photo window tags',
      'Interactive Leaflet Atlas map',
    ],
  },
  {
    name: 'Co-Planner',
    price: '$12',
    unit: '/month',
    summary: 'For pairs and friend groups collaborating live with AI concierge & place discovery.',
    cta: 'Open workspace',
    to: '/home',
    recommended: true,
    features: [
      'Everything in Solo Explorer',
      'Live Viewer & Editor permission roles',
      'Pay-per-use AI Concierge & search',
      'Optional BYO Google Gemini key',
    ],
  },
  {
    name: 'Expedition',
    price: '$24',
    unit: '/month',
    summary: 'Built for photography clubs and extended multi-region itineraries across teams.',
    cta: 'Plan an expedition',
    to: '/trips/new',
    recommended: false,
    features: [
      'Multi-region feasibility comparisons',
      'Shared packing, gear & budget splits',
      'Live weather cache per destination',
      'Priority AI route refinements',
    ],
  },
] as const

const FAQ_ITEMS = [
  {
    question: 'What is Broad Overview Mode and when should I use it?',
    answer:
      'Overview Mode lets you enter candidate cities and your total number of travel days before booking hotels. Trippie calculates intercity transit drag, scores pace comfort, and suggests how many days to allocate per place—then promotes that blueprint into dated stops with one click.',
  },
  {
    question: 'How does Trippie calculate travel times between daily stops?',
    answer:
      'Our route optimizer uses Haversine distance with urban detour factors across walk, public transit, and drive modes while preserving fixed-time anchors such as sunrise viewpoints or dinner reservations.',
  },
  {
    question: 'Can I share an itinerary without letting everyone edit it?',
    answer:
      'Yes. Trip owners invite collaborators by email, directory lookup, or share link as either a read-only Viewer or a Co-Editor. Role permissions are enforced both in the workspace UI and on every server write action.',
  },
  {
    question: 'How are Google Gemini keys and OAuth tokens protected?',
    answer:
      'User Gemini credentials are encrypted server-side with AES-256-GCM (HKDF-SHA256 derived keys and per-user AAD binding) before storage and are never exposed in client-readable queries.',
  },
  {
    question: 'Do I have to pay up front to try Trippie?',
    answer:
      'No. You can preview the interactive Kyoto & Hakone sample atlas at /home without signing in, and external AI/search usage follows pay-as-you-go user billing only when invoked.',
  },
  {
    question: 'Can I export my itinerary for offline travel?',
    answer:
      'Every trip workspace exports cleanly to structured Markdown so you can save schedules, transit notes, photography tips, and checklists onto any phone or offline reader.',
  },
] as const

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openFaqIndices, setOpenFaqIndices] = useState<Record<number, boolean>>({ 0: true })

  function toggleFaq(idx: number) {
    setOpenFaqIndices((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  return (
    <>
      <Seo {...seo} path="/" />
      <div
        data-testid="static-landing"
        className="font-editorial-body min-h-[100dvh] bg-[#f5f4f0] text-[#000000] antialiased"
      >
        {/* 1. Site Header */}
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
              {NAV_LINKS.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="text-[15px] font-normal text-[#373737] transition-colors hover:text-[#000000]"
                >
                  {item.label}
                </a>
              ))}
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
                {NAV_LINKS.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="py-1.5 text-[16px] text-[#373737]"
                  >
                    {item.label}
                  </a>
                ))}
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

        {/* 2. Hero (Alternate ground: #ecebe8) */}
        <section className="bg-[#ecebe8] pb-[64px] pt-[85px] md:pb-[85px] md:pt-[128px]">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-6">
              <h1 className="font-editorial-display text-[62px] font-medium leading-[1.02] tracking-[-0.025em] text-[#000000] md:text-[83px]">
                Chart every hour, not just flights.
              </h1>

              <p className="mt-6 max-w-[34rem] text-[16px] leading-[1.55] text-[#373737]">
                Trippie sequences sights, local restaurants, day trips, and golden-hour photography
                stops around real transit times in one calm collaborative workspace.
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

              <div className="mt-7 flex items-center gap-3">
                <div className="flex -space-x-2">
                  <EditorialAvatar initials="HO" bg="#3c4f4c" label="Hanna Ostrowski" />
                  <EditorialAvatar initials="DM" bg="#5a493c" label="Diego Marlow" />
                  <EditorialAvatar initials="RA" bg="#2e3b4e" label="Ruth Achebe" />
                </div>
                <p className="text-[14px] text-[#505050]">
                  Trusted by 3,200+ travelers &amp; co-planners
                </p>
              </div>

              <hr className="my-7 border-[#d6d5d2]" />

              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                {HERO_METRICS.map((m) => (
                  <div key={m.value}>
                    <p className="font-editorial-display text-[34px] font-medium leading-none tracking-tight text-[#000000]">
                      {m.value}
                    </p>
                    <p className="mt-2 text-[13px] leading-snug text-[#505050]">
                      {m.line1}
                      <br />
                      {m.line2}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-6">
              <HeroProductFrame />
            </div>
          </div>
        </section>

        {/* 3. Logo Cloud (Page ground: #f5f4f0) */}
        <section className="bg-[#f5f4f0] pb-[64px] pt-[85px] md:pb-[85px] md:pt-[104px]">
          <div className="mx-auto max-w-[1200px] px-6 text-center">
            <p className="text-[14px] text-[#505050]">
              Travel clubs and small expeditions that plan with Trippie
            </p>
            <PartnerClubMarks />
          </div>
        </section>

        {/* 4. Features (Page ground: #f5f4f0 — alternating image & text rows) */}
        <section id="features" className="bg-[#f5f4f0] pb-[64px] pt-[64px] md:pb-[85px] md:pt-[85px]">
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-editorial-display text-[38px] font-medium leading-[1.1] tracking-[-0.02em] text-[#000000] md:text-[52px]">
                One atlas for every traveler on the trip
              </h2>
              <p className="mt-4 text-[16px] leading-[1.55] text-[#373737]">
                Move smoothly from open-ended destination exploration to transit-verified hourly
                itineraries, without scattering notes across maps and spreadsheets.
              </p>
            </div>

            <div className="mt-16 space-y-20 md:space-y-24">
              {FEATURE_ROWS.map((row) => (
                <div
                  key={row.title}
                  className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14"
                >
                  <div className={row.imageFirst ? 'lg:col-span-7' : 'lg:order-2 lg:col-span-7'}>
                    {row.media}
                  </div>
                  <div className={row.imageFirst ? 'lg:col-span-5' : 'lg:order-1 lg:col-span-5'}>
                    <h3 className="font-editorial-display text-[32px] font-medium leading-[1.14] tracking-[-0.02em] text-[#000000] md:text-[38px]">
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

        {/* 5. Process (Alternate ground: #ecebe8 — 3 connected numbered steps) */}
        <section id="process" className="bg-[#ecebe8] pb-[64px] pt-[85px] md:pb-[85px] md:pt-[128px]">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-6 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="font-editorial-display text-[38px] font-medium leading-[1.1] tracking-[-0.02em] text-[#000000] md:text-[48px]">
                From rough wish list to timed itinerary in three steps
              </h2>
              <p className="mt-4 max-w-md text-[16px] leading-[1.55] text-[#373737]">
                Start wide to test how many days fit, refine every transit leg, and share the live
                plan with your group.
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

        {/* 6. Testimonials (Page ground: #f5f4f0 — 1 prominent quote + 2 supporting cards) */}
        <section className="bg-[#f5f4f0] pb-[64px] pt-[85px] md:pb-[85px] md:pt-[128px]">
          <div className="mx-auto max-w-[1200px] px-6">
            <h2 className="font-editorial-display text-[36px] font-medium leading-[1.12] tracking-[-0.02em] text-[#000000] md:text-[44px]">
              Travelers switch and keep every trip here
            </h2>

            <div className="mt-10">
              <span
                aria-hidden
                className="font-editorial-display block text-[54px] leading-none text-[#000000]"
              >
                “
              </span>
              <blockquote className="font-editorial-display mt-1 max-w-4xl text-[32px] font-medium leading-[1.18] tracking-[-0.015em] text-[#000000] md:text-[46px]">
                We stopped juggling three spreadsheets and five map tabs. Trippie gave our group a
                calm hour-by-hour route that respected real train times.
              </blockquote>
              <div className="mt-6 flex items-center gap-3">
                <EditorialAvatar initials="HO" bg="#233738" label="Hanna Ostrowski" />
                <div>
                  <p className="text-[14px] font-semibold text-[#000000]">Hanna Ostrowski</p>
                  <p className="text-[13px] text-[#505050]">Operations lead, Tarnwell Expeditions</p>
                </div>
              </div>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {SUPPORTING_QUOTES.map((item) => (
                <div
                  key={item.author}
                  className="flex flex-col justify-between rounded-[8px] border border-[#d6d5d2] bg-[#ecebe8] p-6"
                >
                  <div>
                    <span
                      aria-hidden
                      className="font-editorial-display block text-[36px] leading-none text-[#000000]"
                    >
                      “
                    </span>
                    <p className="mt-2 text-[16px] leading-[1.6] text-[#373737]">{item.quote}</p>
                  </div>
                  <div className="mt-6 flex items-center gap-3">
                    <EditorialAvatar initials={item.initials} bg={item.bg} label={item.author} />
                    <div>
                      <p className="text-[14px] font-semibold text-[#000000]">{item.author}</p>
                      <p className="text-[13px] text-[#505050]">{item.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Pricing (Page ground: #f5f4f0 — 3 side-by-side inset #ecebe8 cards) */}
        <section id="pricing" className="bg-[#f5f4f0] pb-[64px] pt-[64px] md:pb-[85px] md:pt-[85px]">
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="mx-auto max-w-xl text-center">
              <h2 className="font-editorial-display text-[38px] font-medium leading-[1.1] tracking-[-0.02em] text-[#000000] md:text-[50px]">
                Plans that fit how your group travels
              </h2>
              <p className="mt-3 text-[16px] leading-[1.55] text-[#373737]">
                Core itineraries and Overview Mode are free. AI concierge and live discovery follow
                transparent user billing.
              </p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {PRICING_PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={`flex flex-col justify-between rounded-[8px] bg-[#ecebe8] p-6 ${
                    plan.recommended ? 'border border-[#131313]' : 'border border-[#d6d5d2]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[16px] font-semibold text-[#000000]">{plan.name}</h3>
                      {plan.recommended && (
                        <span className="rounded-[6px] bg-[#141314] px-2.5 py-0.5 text-[11px] font-semibold text-[#fcfcfd]">
                          Popular
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="font-editorial-display text-[44px] font-medium leading-none text-[#000000]">
                        {plan.price}
                      </span>
                      <span className="text-[14px] text-[#505050]">{plan.unit}</span>
                    </div>

                    <p className="mt-3 text-[14px] leading-relaxed text-[#373737]">
                      {plan.summary}
                    </p>

                    <Link
                      to={plan.to}
                      className={`mt-5 inline-flex h-11 w-full items-center justify-center rounded-[8px] text-[14px] font-medium transition-opacity ${
                        plan.recommended
                          ? 'bg-[#131313] text-[#fcfcfd] hover:opacity-90'
                          : 'border border-[#d6d5d2] bg-[#f5f4f0] text-[#000000] hover:bg-[#e5e4e0]'
                      }`}
                    >
                      {plan.cta}
                    </Link>

                    <ul className="mt-6 space-y-2.5 border-t border-[#d6d5d2] pt-5">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2.5 text-[14px] text-[#373737]">
                          <Check className="mt-0.5 size-4 shrink-0 text-[#000000]" aria-hidden />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 8. FAQ (Alternate ground: #ecebe8 — 6 expandable questions) */}
        <section id="faq" className="bg-[#ecebe8] pb-[64px] pt-[85px] md:pb-[85px] md:pt-[128px]">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-6 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <h2 className="font-editorial-display text-[36px] font-medium leading-[1.12] tracking-[-0.02em] text-[#000000] md:text-[44px]">
                Questions from travelers
              </h2>
              <p className="mt-3 text-[15px] leading-[1.55] text-[#373737]">
                Everything you need to know about pacing calculations, sharing roles, and AI model
                privacy.
              </p>
              <Link
                to="/home"
                className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-medium text-[#000000] underline-offset-4 hover:underline"
              >
                <span>Explore live sample trip</span>
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>

            <div className="divide-y divide-[#d6d5d2] border-t border-[#d6d5d2] lg:col-span-8">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = Boolean(openFaqIndices[idx])
                return (
                  <div key={item.question} className="py-5">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggleFaq(idx)}
                      className="flex w-full items-center justify-between gap-4 text-left"
                    >
                      <span className="text-[16px] font-medium text-[#000000]">
                        {item.question}
                      </span>
                      <span className="flex size-7 shrink-0 items-center justify-center text-[#373737]">
                        {isOpen ? (
                          <Minus className="size-4" aria-hidden />
                        ) : (
                          <Plus className="size-4" aria-hidden />
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <p className="mt-3 max-w-[65ch] text-[15px] leading-[1.6] text-[#373737]">
                        {item.answer}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* 9. Closing (Inverse ground: #141314) */}
        <section className="bg-[#141314] py-[64px] text-[#fcfcfd] md:py-[85px]">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 px-6 md:flex-row md:items-center">
            <h2 className="font-editorial-display text-[36px] font-medium leading-[1.1] tracking-[-0.02em] text-[#fcfcfd] md:text-[48px]">
              Give your next trip a calmer cadence.
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/trips/new"
                className="inline-flex h-11 items-center justify-center rounded-[8px] bg-[#fcfcfd] px-5 text-[15px] font-medium text-[#141314] transition-opacity hover:opacity-90"
              >
                Start a trip
              </Link>
              <Link
                to="/overview"
                className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[#fcfcfd]/25 bg-transparent px-5 text-[15px] font-medium text-[#fcfcfd] transition-colors hover:bg-white/10"
              >
                Try Overview Mode
              </Link>
            </div>
          </div>
        </section>

        {/* 10. Footer (Page ground: #f5f4f0) */}
        <footer className="bg-[#f5f4f0] pb-10 pt-16 text-[#373737]">
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="grid gap-10 md:grid-cols-12">
              <div className="md:col-span-5">
                <Link to="/" className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-[8px] bg-[#131313] text-[#fcfcfd]">
                    <Compass className="size-4" aria-hidden />
                  </span>
                  <span className="font-editorial-display text-[22px] font-medium text-[#000000]">
                    {APP_NAME}
                  </span>
                </Link>
                <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-[#505050]">
                  Collaborative travel planning with travel-time route optimization, overview
                  pacing, and golden-hour discovery. Built on DeepSpace.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-6 text-[14px] md:col-span-7">
                <div>
                  <h3 className="font-semibold text-[#000000]">Product</h3>
                  <ul className="mt-3 space-y-2.5">
                    <li>
                      <Link to="/home" className="hover:text-[#000000]">
                        Sample Atlas
                      </Link>
                    </li>
                    <li>
                      <Link to="/overview" className="hover:text-[#000000]">
                        Overview Mode
                      </Link>
                    </li>
                    <li>
                      <Link to="/trips/new" className="hover:text-[#000000]">
                        New Trip
                      </Link>
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-[#000000]">Planning</h3>
                  <ul className="mt-3 space-y-2.5">
                    <li>
                      <a href="#features" className="hover:text-[#000000]">
                        Route Engine
                      </a>
                    </li>
                    <li>
                      <a href="#process" className="hover:text-[#000000]">
                        How It Works
                      </a>
                    </li>
                    <li>
                      <a href="#pricing" className="hover:text-[#000000]">
                        Plans
                      </a>
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-[#000000]">Workspace</h3>
                  <ul className="mt-3 space-y-2.5">
                    <li>
                      <Link to="/settings" className="hover:text-[#000000]">
                        Preferences
                      </Link>
                    </li>
                    <li>
                      <a href="#faq" className="hover:text-[#000000]">
                        FAQ
                      </a>
                    </li>
                    <li>
                      <Link to="/home" className="hover:text-[#000000]">
                        Launch App
                      </Link>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[#d6d5d2] pt-6 text-[13px] text-[#505050]">
              <span>© 2026 {APP_NAME}. Built on DeepSpace.</span>
              <div className="flex items-center gap-5">
                <Link to="/home" className="hover:text-[#000000]">
                  Atlas
                </Link>
                <Link to="/overview" className="hover:text-[#000000]">
                  Overview
                </Link>
                <Link to="/settings" className="hover:text-[#000000]">
                  Settings
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
