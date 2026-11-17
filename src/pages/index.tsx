/**
 * Design Direction
 *
 * Product: Trippie is a dark-atlas vacation planner that sequences sights, restaurants, day trips, and photography windows around real transit times.
 * Emotion: Quiet nocturnal clarity — like spreading a brass-inked night chart across a cabin desk before dawn.
 * Metaphor: A cartographic flight deck plotting golden-hour pins, transit arcs, and day-by-day pacing on obsidian slate.
 * References: Marine navigation chartplotters, Leica viewfinder telemetry, Swiss railway timetable boards.
 * Signature: A hairline coordinate grid paired with an interactive nocturnal route card showing live transit leg minutes and golden-hour light tags.
 * Hero: An interactive React atlas card plots three Kyoto stops linked by walk and rail arcs while a subtle route pulse traces the leg.
 *
 * Style Tile
 * - Color: Obsidian-navy dominant with warm compass-amber accent, restrained saturation.
 * - Type: Crisp system grotesk headings paired with tabular monospace telemetry for times and distances.
 * - Theme: Dark (atlas) — keeps map pins and golden-hour callouts luminous without glare.
 * - Art direction: Precision cartographic telemetry — hairline borders, numbered nodes, zero stock photography.
 * - Motion: Measured mechanical glide respecting prefers-reduced-motion.
 * - Voice: Concise, geographic, practical; states transit minutes and light windows instead of travel clichés.
 */

import { Link } from 'react-router-dom'
import { ArrowRight, Camera, Clock, Compass, Route, Users } from 'lucide-react'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const SAMPLE_LEGS = [
  {
    idx: '01',
    time: '06:30',
    title: 'Kiyomizu-dera Terrace',
    tag: 'Sunrise · 60 min',
    leg: '12 min walk · 0.9 km',
  },
  {
    idx: '02',
    time: '07:45',
    title: 'Yasaka Pagoda Lane',
    tag: 'Must-See · 60 min',
    leg: '24 min transit · 5.4 km',
  },
  {
    idx: '03',
    time: '17:15',
    title: 'Fushimi Inari Ridge',
    tag: 'Golden Hour · 90 min',
    leg: null,
  },
] as const

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div
        data-testid="static-landing"
        className="relative min-h-screen overflow-hidden bg-background text-foreground"
      >
        {/* Subtle cartographic coordinate grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Compass className="size-4" aria-hidden />
            </span>
            <span className="text-base font-semibold tracking-tight">{APP_NAME}</span>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              to="/home"
              className="rounded-md border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              Preview Atlas
            </Link>
            <Link
              to="/trips/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start a Trip
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </nav>
        </header>

        <main className="relative mx-auto max-w-6xl px-6 pb-20 pt-10 md:pt-16">
          {/* Hero Split */}
          <section className="grid items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="font-mono text-xs uppercase tracking-widest text-primary">
                35.0116° N · 135.7681° E
              </p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Chart every hour, not just flights.
              </h1>
              <p className="mt-5 max-w-lg text-base text-muted-foreground">
                Sequence sights, restaurants, day trips, and golden-hour photo spots around real
                transit times—steered by conversational AI and shared live.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/home"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Open Atlas Workspace
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link
                  to="/overview"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Try Overview Mode
                </Link>
              </div>
            </div>

            {/* Hero React Atlas Visual */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card-hover)]">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-primary">
                      Day 01 · Optimized Route
                    </p>
                    <h2 className="mt-0.5 text-sm font-semibold text-foreground">
                      Kyoto Higashiyama Loop
                    </h2>
                  </div>
                  <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground">
                    −38 min transit
                  </span>
                </div>

                <div className="mt-4 space-y-2.5">
                  {SAMPLE_LEGS.map((stop) => (
                    <div key={stop.idx}>
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-3.5 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="flex size-6 items-center justify-center rounded-full bg-primary font-mono text-[11px] font-bold text-primary-foreground">
                            {stop.idx}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-foreground">{stop.title}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {stop.time} · {stop.tag}
                            </p>
                          </div>
                        </div>
                        <Camera className="size-3.5 text-primary" aria-hidden />
                      </div>
                      {stop.leg && (
                        <div className="ml-6 flex items-center gap-2 border-l border-dashed border-border py-1.5 pl-4 font-mono text-[11px] text-muted-foreground">
                          <Clock className="size-3 text-primary" aria-hidden />
                          <span>{stop.leg}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Alternating Asymmetric Showcase — avoids 3-identical-cards pattern */}
          <section className="mt-20 grid gap-6 border-t border-border pt-14 md:grid-cols-12">
            <div className="rounded-2xl border border-border bg-card p-6 md:col-span-7">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
                <Route className="size-4" aria-hidden />
                <span>Broad Overview + Route Engine</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold text-foreground">
                Know how many days each city actually earns.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Start in Overview Mode with candidate cities and total days to check transit drag
                and pacing, then expand into an anchor-aware daily schedule.
              </p>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 md:col-span-5">
              <div>
                <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
                  <Users className="size-4" aria-hidden />
                  <span>Viewer &amp; Editor Permissions</span>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-foreground">
                  Co-plan live without accidental edits.
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Invite companions as read-only viewers or full editors with instant Durable Object
                  sync.
                </p>
              </div>
              <Link
                to="/home"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                Explore the live sample trip
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </section>
        </main>

        <footer className="relative border-t border-border py-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-xs text-muted-foreground">
            <span>{APP_NAME} · Built on DeepSpace</span>
            <Link to="/home" className="hover:text-foreground">
              Launch app
            </Link>
          </div>
        </footer>
      </div>
    </>
  )
}
