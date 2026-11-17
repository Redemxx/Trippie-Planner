import { useState } from 'react'
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  Gauge,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  Modal,
  useToast,
} from '@/components/ui'
import type { DestinationData, OverviewData } from '@/lib/trip-types'

interface OverviewPlannerViewProps {
  tripId: string
  totalDays: number
  destinations: Array<DestinationData & { id: string }>
  overview: OverviewData | null
  canEdit: boolean
  onAddDestination: (name: string, country?: string) => Promise<void>
  onRemoveDestination: (destinationId: string) => Promise<void>
  onGenerateOverview: (totalDays: number, useAi: boolean) => Promise<void>
  onPromoteToDetailed: (startDate: string) => Promise<void>
  onAskAi?: (prompt: string) => void
}

const FEASIBILITY_BADGE: Record<
  OverviewData['feasibilityStatus'],
  { label: string; tone: string }
> = {
  comfortable: { label: 'Comfortable Pace', tone: 'text-success border-success/40' },
  ambitious: { label: 'Brisk / Ambitious', tone: 'text-warning border-warning/40' },
  overpacked: { label: 'Overpacked — Trim or Extend', tone: 'text-destructive border-destructive/40' },
}

export function OverviewPlannerView({
  totalDays,
  destinations,
  overview,
  canEdit,
  onAddDestination,
  onRemoveDestination,
  onGenerateOverview,
  onPromoteToDetailed,
  onAskAi,
}: OverviewPlannerViewProps) {
  const { success, error } = useToast()
  const [daysInput, setDaysInput] = useState(String(totalDays || 6))
  const [newPlace, setNewPlace] = useState('')
  const [newCountry, setNewCountry] = useState('')
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [promoting, setPromoting] = useState(false)

  async function handleAddLocation() {
    if (!newPlace.trim()) return
    setAdding(true)
    try {
      await onAddDestination(newPlace.trim(), newCountry.trim() || undefined)
      setNewPlace('')
      setNewCountry('')
      success('Location added', 'Updated destination list for overview pacing.')
    } catch (err) {
      error('Could not add location', err instanceof Error ? err.message : 'Failed')
    } finally {
      setAdding(false)
    }
  }

  async function handleCompute(useAi: boolean) {
    const parsedDays = Math.max(1, Math.min(60, Number(daysInput) || totalDays || 6))
    setGenerating(true)
    try {
      await onGenerateOverview(parsedDays, useAi)
      success('Overview updated', `Computed recommended stays across ${parsedDays} days.`)
    } catch (err) {
      error('Could not compute overview', err instanceof Error ? err.message : 'Failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handlePromote() {
    setPromoting(true)
    try {
      await onPromoteToDetailed(startDate)
      setPromoteOpen(false)
      success('Converted to detailed itinerary', 'Your destinations now have dated legs and starter stops.')
    } catch (err) {
      error('Conversion failed', err instanceof Error ? err.message : 'Failed')
    } finally {
      setPromoting(false)
    }
  }

  const badge = overview ? FEASIBILITY_BADGE[overview.feasibilityStatus] : null

  return (
    <div className="space-y-6">
      {/* Control Strip */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="overview-days">Total trip timeframe (days)</Label>
              <Input
                id="overview-days"
                type="number"
                min={1}
                max={60}
                value={daysInput}
                disabled={!canEdit}
                onChange={(e) => setDaysInput(e.target.value)}
                className="w-28"
              />
            </div>

            {canEdit && (
              <>
                <div>
                  <Label htmlFor="overview-place">Add destination</Label>
                  <Input
                    id="overview-place"
                    value={newPlace}
                    onChange={(e) => setNewPlace(e.target.value)}
                    placeholder="e.g. Lisbon"
                    className="w-44"
                  />
                </div>
                <div>
                  <Label htmlFor="overview-country">Country (optional)</Label>
                  <Input
                    id="overview-country"
                    value={newCountry}
                    onChange={(e) => setNewCountry(e.target.value)}
                    placeholder="Portugal"
                    className="w-36"
                  />
                </div>
                <Button variant="secondary" loading={adding} onClick={handleAddLocation}>
                  <Plus className="size-3.5" aria-hidden />
                  Add
                </Button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <Button
                  variant="outline"
                  loading={generating}
                  onClick={() => void handleCompute(false)}
                  data-testid="overview-recompute-btn"
                >
                  <Gauge className="size-3.5" aria-hidden />
                  Recalculate Timeline
                </Button>
                <Button loading={generating} onClick={() => void handleCompute(true)}>
                  <Sparkles className="size-3.5" aria-hidden />
                  AI Blueprint
                </Button>
                {overview && overview.allocations.length > 0 && (
                  <Button variant="secondary" onClick={() => setPromoteOpen(true)}>
                    <ArrowRight className="size-3.5" aria-hidden />
                    Convert to Detailed Itinerary
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Destination chips */}
        {destinations.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {destinations
              .slice()
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((d, idx) => (
                <div
                  key={d.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs"
                >
                  <span className="font-mono text-primary">{idx + 1}.</span>
                  <span className="font-medium text-foreground">
                    {d.name}
                    {d.country ? `, ${d.country}` : ''}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${d.name}`}
                      onClick={() => void onRemoveDestination(d.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Overview Results */}
      {!overview || overview.allocations.length === 0 ? (
        <EmptyState
          icon={<Compass className="size-5" />}
          title="No overview blueprint yet"
          description="Add the locations you want to visit and your available days to see how long to stay at each stop and what is realistic."
          action={
            canEdit && destinations.length > 0
              ? { label: 'Generate Timeline', onClick: () => void handleCompute(false) }
              : undefined
          }
        />
      ) : (
        <>
          {/* Feasibility Banner */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {badge && (
                  <Badge variant="outline" className={badge.tone}>
                    {badge.label}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  Feasibility Score: <strong className="text-foreground">{overview.feasibilityScore}/100</strong>
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3.5 text-primary" aria-hidden />
                  ~{overview.totalTransitHours}h intercity transit
                </span>
              </div>
              {onAskAi && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onAskAi(
                      'Based on our broad overview, should we cut any stop or shift days to keep the pace enjoyable?',
                    )
                  }
                >
                  <Sparkles className="size-3.5 text-primary" aria-hidden />
                  Ask AI to critique pacing
                </Button>
              )}
            </div>
            <p className="mt-3 text-sm text-foreground">{overview.summary}</p>

            {/* Proportional Time Bar */}
            <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full border border-border bg-muted">
              {overview.allocations.map((alloc, i) => {
                const totalAllocated = overview.allocations.reduce(
                  (sum, a) => sum + a.recommendedDays,
                  0,
                )
                const pct = Math.max(8, (alloc.recommendedDays / Math.max(1, totalAllocated)) * 100)
                const opacities = ['opacity-100', 'opacity-80', 'opacity-65', 'opacity-50']
                return (
                  <div
                    key={alloc.destinationName + i}
                    style={{ width: `${pct}%` }}
                    title={`${alloc.destinationName}: ${alloc.recommendedDays} days`}
                    className={`h-full border-r border-background bg-primary ${opacities[i % opacities.length]}`}
                  />
                )
              })}
            </div>
          </div>

          {/* Per-location stay recommendations */}
          <div className="grid gap-4 md:grid-cols-2">
            {overview.allocations.map((alloc, i) => (
              <div key={alloc.destinationName + i} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <MapPin className="size-4 text-primary" aria-hidden />
                      <h4 className="text-base font-semibold text-foreground">
                        {alloc.destinationName}
                        {alloc.country ? `, ${alloc.country}` : ''}
                      </h4>
                    </div>
                    {i > 0 && alloc.transitHoursFromPrev > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        ~{alloc.transitHoursFromPrev}h {alloc.transportMode} from previous stop
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <Badge>{alloc.recommendedDays} days</Badge>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Min viable: {alloc.minDays}d
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">{alloc.rationale}</p>

                <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
                  {alloc.mustSeeHighlights.length > 0 && (
                    <div>
                      <span className="font-medium text-foreground">Highlights: </span>
                      <span className="text-muted-foreground">
                        {alloc.mustSeeHighlights.join(' · ')}
                      </span>
                    </div>
                  )}
                  {alloc.photoSpots.length > 0 && (
                    <div className="flex items-start gap-1.5">
                      <Camera className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      <span className="text-muted-foreground">{alloc.photoSpots.join(' · ')}</span>
                    </div>
                  )}
                  {alloc.dayTripIdeas.length > 0 && (
                    <div className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                      <span className="text-muted-foreground">
                        Day trip option: {alloc.dayTripIdeas.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Generalized Daily Outline */}
          {overview.dailyOutline.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Generalized Suggested Timeline</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {overview.dailyOutline.map((block) => (
                  <div
                    key={block.dayNumber}
                    className="rounded-lg border border-border bg-muted/40 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-primary">
                        Day {block.dayNumber} · {block.location}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">{block.theme}</span>
                    </div>
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      <li>
                        <strong className="text-foreground">AM:</strong> {block.morning}
                      </li>
                      <li>
                        <strong className="text-foreground">PM:</strong> {block.afternoon}
                      </li>
                      <li>
                        <strong className="text-foreground">Eve:</strong> {block.evening}
                      </li>
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Promote Modal */}
      <Modal open={promoteOpen} onClose={() => setPromoteOpen(false)}>
        <Modal.Header>
          <h3 className="text-base font-semibold text-foreground">
            Convert Overview to Detailed Itinerary
          </h3>
        </Modal.Header>
        <Modal.Body className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pick your departure date. Trippie will assign arrival/departure dates for each
            destination based on the recommended days and seed starter daily stops.
          </p>
          <div>
            <Label htmlFor="promote-start">Trip start date</Label>
            <Input
              id="promote-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline" onClick={() => setPromoteOpen(false)}>
            Cancel
          </Button>
          <Button loading={promoting} onClick={handlePromote}>
            Build Detailed Itinerary
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
