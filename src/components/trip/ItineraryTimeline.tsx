import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Camera,
  Clock,
  Compass,
  MapPin,
  Pencil,
  Plus,
  Route,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmModal,
  EmptyState,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from '@/components/ui'
import { computeDaySchedule } from '@/lib/route-optimizer'
import {
  CATEGORY_META,
  LIGHT_WINDOW_LABELS,
  type LightWindow,
  type PreferredWindow,
  type StopCategory,
  type StopData,
  type TransportMode,
} from '@/lib/trip-types'

export interface TimelineStopRecord extends StopData {
  id: string
}

interface ItineraryTimelineProps {
  tripId: string
  dayNumber: number
  totalDays: number
  onSelectDay: (day: number) => void
  stops: TimelineStopRecord[]
  canEdit: boolean
  currency?: string
  selectedStopId?: string | null
  onSelectStop?: (stopId: string) => void
  onOptimizeDay: (dayNumber: number) => Promise<{
    minutesSaved?: number
    distanceSavedKm?: number
  }>
  onSaveStop: (payload: Partial<StopData> & { stopId?: string; dayNumber: number; title: string; category: StopCategory }) => Promise<void>
  onMoveStop: (stopId: string, direction: 'up' | 'down') => Promise<void>
  onDeleteStop: (stopId: string) => Promise<void>
  onAskAi?: (prompt: string) => void
}

const STOP_CATEGORY_ITEMS: Record<StopCategory, string> = {
  must_see: 'Must-See Landmark',
  restaurant: 'Restaurant / Cafe',
  photo_spot: 'Photography Spot',
  day_trip: 'Day Trip / Excursion',
  hidden_gem: 'Hidden Gem',
  lodging: 'Lodging / Base',
  transit: 'Transit Hub',
}

const TRANSPORT_ITEMS: Record<TransportMode, string> = {
  walk: 'Walk',
  transit: 'Transit',
  drive: 'Drive / Taxi',
}

const PREFERRED_WINDOW_ITEMS: Record<PreferredWindow, string> = {
  any: 'Flexible time',
  sunrise: 'Sunrise',
  morning: 'Morning',
  lunch: 'Lunch',
  afternoon: 'Afternoon',
  golden_hour: 'Golden hour',
  dinner: 'Dinner',
  night: 'Night',
}

const LIGHT_ITEMS: Record<LightWindow, string> = {
  any: 'Any light',
  sunrise: 'Sunrise',
  golden_hour: 'Golden hour',
  blue_hour: 'Blue hour',
  midday: 'Midday',
  night: 'Night / Neon',
}

export function ItineraryTimeline({
  dayNumber,
  totalDays,
  onSelectDay,
  stops,
  canEdit,
  currency = 'USD',
  selectedStopId,
  onSelectStop,
  onOptimizeDay,
  onSaveStop,
  onMoveStop,
  onDeleteStop,
  onAskAi,
}: ItineraryTimelineProps) {
  const { success, error } = useToast()
  const [optimizing, setOptimizing] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingStop, setEditingStop] = useState<TimelineStopRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TimelineStopRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<StopCategory>('must_see')
  const [address, setAddress] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('75')
  const [preferredWindow, setPreferredWindow] = useState<PreferredWindow>('any')
  const [fixedTime, setFixedTime] = useState(false)
  const [startTime, setStartTime] = useState('09:00')
  const [transportMode, setTransportMode] = useState<TransportMode>('transit')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [bestLightWindow, setBestLightWindow] = useState<LightWindow>('any')
  const [photoTip, setPhotoTip] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const dayStops = useMemo(
    () =>
      stops
        .filter((s) => s.dayNumber === dayNumber)
        .slice()
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    [stops, dayNumber],
  )

  const schedule = useMemo(() => computeDaySchedule(dayStops), [dayStops])

  function openAddModal(presetCategory: StopCategory = 'must_see') {
    setEditingStop(null)
    setTitle('')
    setCategory(presetCategory)
    setAddress('')
    setDurationMinutes(presetCategory === 'photo_spot' ? '45' : '75')
    setPreferredWindow(presetCategory === 'photo_spot' ? 'golden_hour' : 'any')
    setFixedTime(false)
    setStartTime('09:00')
    setTransportMode('transit')
    setEstimatedCost('')
    setBestLightWindow(presetCategory === 'photo_spot' ? 'golden_hour' : 'any')
    setPhotoTip('')
    setNotes('')
    setFormError('')
    setModalOpen(true)
  }

  function openEditModal(stop: TimelineStopRecord) {
    setEditingStop(stop)
    setTitle(stop.title)
    setCategory(stop.category)
    setAddress(stop.address ?? '')
    setDurationMinutes(String(stop.durationMinutes ?? 75))
    setPreferredWindow(stop.preferredWindow ?? 'any')
    setFixedTime(Boolean(stop.fixedTime))
    setStartTime(stop.startTime ?? '09:00')
    setTransportMode(stop.transportMode ?? 'transit')
    setEstimatedCost(stop.estimatedCost !== undefined ? String(stop.estimatedCost) : '')
    setBestLightWindow(stop.bestLightWindow ?? 'any')
    setPhotoTip(stop.photoTip ?? '')
    setNotes(stop.notes ?? '')
    setFormError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!title.trim()) {
      setFormError('Please enter a place or activity name.')
      return
    }
    setSaving(true)
    try {
      await onSaveStop({
        stopId: editingStop?.id,
        dayNumber,
        title: title.trim(),
        category,
        address: address.trim() || undefined,
        durationMinutes: Math.max(15, Number(durationMinutes) || 60),
        preferredWindow,
        fixedTime,
        startTime: fixedTime ? startTime : undefined,
        transportMode,
        estimatedCost: estimatedCost ? Math.max(0, Number(estimatedCost)) : undefined,
        bestLightWindow,
        photoTip: photoTip.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      setModalOpen(false)
      success(editingStop ? 'Stop updated' : 'Stop added', `Updated Day ${dayNumber} schedule.`)
    } catch (err) {
      error('Could not save stop', err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleOptimize() {
    setOptimizing(true)
    try {
      const res = await onOptimizeDay(dayNumber)
      const saved = res.minutesSaved ?? 0
      success(
        'Route optimized',
        saved > 0
          ? `Saved ~${saved} min and ${res.distanceSavedKm ?? 0} km of transit on Day ${dayNumber}.`
          : `Day ${dayNumber} stops are already in optimal sequence.`,
      )
    } catch (err) {
      error('Optimization failed', err instanceof Error ? err.message : 'Could not optimize')
    } finally {
      setOptimizing(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await onDeleteStop(deleteTarget.id)
      success('Stop removed', `"${deleteTarget.title}" removed from Day ${dayNumber}.`)
      setDeleteTarget(null)
    } catch (err) {
      error('Delete failed', err instanceof Error ? err.message : 'Could not delete stop')
    } finally {
      setDeleting(false)
    }
  }

  const dayTabs = Array.from({ length: Math.max(1, totalDays) }, (_, i) => i + 1)

  return (
    <div className="flex flex-col gap-4">
      {/* Day Selector Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="no-scrollbar flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {dayTabs.map((d) => {
            const count = stops.filter((s) => s.dayNumber === d).length
            const active = d === dayNumber
            return (
              <button
                key={d}
                type="button"
                onClick={() => onSelectDay(d)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span>Day {d}</span>
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-foreground'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && dayStops.length >= 2 && (
            <Button
              size="sm"
              variant="secondary"
              loading={optimizing}
              onClick={handleOptimize}
              data-testid="optimize-day-button"
            >
              <Route className="size-3.5" aria-hidden />
              Optimize Day Route
            </Button>
          )}
          {onAskAi && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onAskAi(
                  `Suggest 3 balanced stops (including a golden-hour photo spot and great local restaurant) for Day ${dayNumber} and add them if I have editor access.`,
                )
              }
            >
              <Sparkles className="size-3.5 text-primary" aria-hidden />
              AI Fill Day {dayNumber}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => openAddModal('must_see')} data-testid="add-stop-button">
              <Plus className="size-3.5" aria-hidden />
              Add Stop
            </Button>
          )}
        </div>
      </div>

      {/* Day Metrics Strip */}
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-3 text-xs">
        <div>
          <span className="text-muted-foreground">Stops</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{schedule.items.length}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Total Transit</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {schedule.totalTravelMinutes} min ({schedule.totalDistanceKm.toFixed(1)} km)
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Activity Time</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {(schedule.totalActivityMinutes / 60).toFixed(1)} hrs
          </p>
        </div>
      </div>

      {/* Warnings */}
      {schedule.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-warning/40 bg-card p-3">
          {schedule.warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Timeline Stops */}
      {schedule.items.length === 0 ? (
        <EmptyState
          icon={<Compass className="size-5" />}
          title={`Day ${dayNumber} is open`}
          description="Add must-see sights, restaurants, day trips, or golden-hour photo spots—or ask the AI Concierge to draft this day."
          action={
            canEdit
              ? { label: 'Add first stop', onClick: () => openAddModal('must_see') }
              : undefined
          }
          secondaryAction={
            onAskAi
              ? {
                  label: 'Ask AI Concierge',
                  onClick: () =>
                    onAskAi(
                      `Plan Day ${dayNumber} of this trip with well-paced stops, lunch, and a photo spot.`,
                    ),
                }
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col">
          {schedule.items.map((item, idx) => {
            const { stop } = item
            const meta = CATEGORY_META[stop.category] ?? CATEGORY_META.must_see
            const selected = stop.id === selectedStopId

            return (
              <div key={stop.id} className="flex flex-col">
                {idx > 0 && (
                  <div className="ml-5 flex items-center gap-2 border-l border-dashed border-border py-2 pl-4 text-[11px] text-muted-foreground">
                    <Clock className="size-3 text-primary" aria-hidden />
                    <span>
                      {item.travelMinutesFromPrev} min {stop.transportMode ?? 'transit'} ·{' '}
                      {item.travelDistanceKmFromPrev.toFixed(1)} km
                    </span>
                  </div>
                )}

                <div
                  onClick={() => onSelectStop?.(stop.id)}
                  data-testid={`stop-card-${idx}`}
                  className={`group rounded-xl border p-3.5 transition-colors ${
                    selected
                      ? 'border-primary bg-accent/40'
                      : 'border-border bg-card hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-primary-foreground"
                        style={{ backgroundColor: meta.color }}
                      >
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-primary">
                            {item.startTime}–{item.endTime}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {meta.label}
                          </Badge>
                          {stop.fixedTime && (
                            <Badge variant="outline" className="text-[10px]">
                              Locked
                            </Badge>
                          )}
                          {stop.rating && (
                            <span className="text-[11px] text-muted-foreground">
                              ★ {stop.rating.toFixed(1)}
                            </span>
                          )}
                          {typeof stop.estimatedCost === 'number' && stop.estimatedCost > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              ~{currency} {stop.estimatedCost}
                            </span>
                          )}
                        </div>

                        <h4 className="mt-1 text-sm font-semibold text-foreground">{stop.title}</h4>

                        {stop.address && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{stop.address}</span>
                          </p>
                        )}

                        {(stop.bestLightWindow && stop.bestLightWindow !== 'any') || stop.photoTip ? (
                          <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs">
                            <Camera className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                            <div>
                              {stop.bestLightWindow && stop.bestLightWindow !== 'any' && (
                                <span className="mr-1.5 inline-flex items-center gap-1 font-medium text-primary">
                                  <Sun className="size-3" aria-hidden />
                                  {LIGHT_WINDOW_LABELS[stop.bestLightWindow]}:
                                </span>
                              )}
                              <span className="text-muted-foreground">
                                {stop.photoTip || 'Recommended lighting window for photography.'}
                              </span>
                            </div>
                          </div>
                        ) : null}

                        {stop.notes && (
                          <p className="mt-2 text-xs text-muted-foreground">{stop.notes}</p>
                        )}
                      </div>
                    </div>

                    {canEdit && (
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Move up"
                          disabled={idx === 0}
                          onClick={() => void onMoveStop(stop.id, 'up')}
                        >
                          <ArrowUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Move down"
                          disabled={idx === schedule.items.length - 1}
                          onClick={() => void onMoveStop(stop.id, 'down')}
                        >
                          <ArrowDown className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit stop"
                          onClick={() => openEditModal(stop)}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Delete stop"
                          onClick={() => setDeleteTarget(stop)}
                        >
                          <Trash2 className="size-3.5 text-destructive" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit Stop Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <Modal.Header>
          <h3 className="text-base font-semibold text-foreground">
            {editingStop ? 'Edit Stop' : `Add Stop to Day ${dayNumber}`}
          </h3>
        </Modal.Header>
        <Modal.Body className="space-y-3">
          <div>
            <Label htmlFor="stop-title">Place or activity</Label>
            <Input
              id="stop-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kiyomizu-dera Terrace"
            />
            {formError && <p className="mt-1 text-xs text-destructive">{formError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => v && setCategory(v as StopCategory)}
                items={STOP_CATEGORY_ITEMS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STOP_CATEGORY_ITEMS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Transport from prev</Label>
              <Select
                value={transportMode}
                onValueChange={(v) => v && setTransportMode(v as TransportMode)}
                items={TRANSPORT_ITEMS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRANSPORT_ITEMS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="stop-address">Address or neighborhood (used for travel-time routing)</Label>
            <Input
              id="stop-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Higashiyama Ward, Kyoto"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="stop-duration">Duration (min)</Label>
              <Input
                id="stop-duration"
                type="number"
                min={15}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </div>
            <div>
              <Label>Preferred window</Label>
              <Select
                value={preferredWindow}
                onValueChange={(v) => v && setPreferredWindow(v as PreferredWindow)}
                items={PREFERRED_WINDOW_ITEMS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PREFERRED_WINDOW_ITEMS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="stop-cost">Est. cost ({currency})</Label>
              <Input
                id="stop-cost"
                type="number"
                min={0}
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Checkbox
              id="stop-fixed"
              checked={fixedTime}
              onCheckedChange={(checked) => setFixedTime(Boolean(checked))}
            />
            <Label htmlFor="stop-fixed">Lock exact start time (reservation / timed ticket)</Label>
            {fixedTime && (
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-32"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Photo light window</Label>
              <Select
                value={bestLightWindow}
                onValueChange={(v) => v && setBestLightWindow(v as LightWindow)}
                items={LIGHT_ITEMS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LIGHT_ITEMS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="stop-photo-tip">Photo / vantage tip</Label>
              <Input
                id="stop-photo-tip"
                value={photoTip}
                onChange={(e) => setPhotoTip(e.target.value)}
                placeholder="e.g. Shoot from north pier at dusk"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="stop-notes">Notes</Label>
            <Textarea
              id="stop-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Booking reminders, dietary picks, backup ideas..."
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline" onClick={() => setModalOpen(false)}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleSave}>
            {editingStop ? 'Save changes' : 'Add stop'}
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={`Remove "${deleteTarget?.title ?? ''}"?`}
        description="This will delete the stop and recalculate travel times for this day."
        confirmText="Remove stop"
        variant="destructive"
        loading={deleting}
      />
    </div>
  )
}
