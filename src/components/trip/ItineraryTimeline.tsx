import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BedDouble,
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
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
import {
  computeDaySchedule,
  formatMinutesHuman,
  isCheckInOrOutStop,
  isIntercityLegCard,
  resolveDayContext,
  type HotelOrigin,
} from '@/lib/route-optimizer'
import {
  CATEGORY_META,
  LIGHT_WINDOW_LABELS,
  TRANSPORT_MODE_LABELS,
  type DestinationData,
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
  tripStartDate?: string
  destinations?: Array<DestinationData & { id?: string }>
  onSelectDay: (day: number) => void
  stops: TimelineStopRecord[]
  canEdit: boolean
  currency?: string
  selectedStopId?: string | null
  onSelectStop?: (stopId: string) => void
  liveNowMinutes?: number
  isActiveToday?: boolean
  onOptimizeDay: (dayNumber: number) => Promise<{
    minutesSaved?: number
    distanceSavedKm?: number
  }>
  onSaveStop: (
    payload: Partial<StopData> & {
      stopId?: string
      dayNumber: number
      title: string
      category: StopCategory
      refreshGeocode?: boolean
    },
  ) => Promise<void>
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
  transit: 'Local transit / Rail',
  bullet_train: 'Bullet train',
  drive: 'Drive / Taxi',
  flight: 'Flight',
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
  tripStartDate,
  destinations = [],
  onSelectDay,
  stops,
  canEdit,
  currency = 'USD',
  selectedStopId,
  onSelectStop,
  liveNowMinutes,
  isActiveToday = false,
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
  const [refreshGeocode, setRefreshGeocode] = useState(false)
  const [formError, setFormError] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState('')
  const calendarPopoverRef = useRef<HTMLDivElement>(null)

  const dayStops = useMemo(
    () =>
      stops
        .filter((s) => s.dayNumber === dayNumber)
        .slice()
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    [stops, dayNumber],
  )

  const dayTabs = useMemo(
    () =>
      Array.from({ length: Math.max(1, totalDays) }, (_, i) =>
        resolveDayContext(i + 1, totalDays, tripStartDate, destinations),
      ),
    [totalDays, tripStartDate, destinations],
  )

  const activeDayContext = useMemo(
    () =>
      dayTabs.find((t) => t.dayNumber === dayNumber) ??
      resolveDayContext(dayNumber, totalDays, tripStartDate, destinations),
    [dayTabs, dayNumber, totalDays, tripStartDate, destinations],
  )

  const validDateMap = useMemo(() => {
    const map = new Map<string, (typeof dayTabs)[number]>()
    for (const ctx of dayTabs) {
      if (ctx.isoDate) map.set(ctx.isoDate, ctx)
    }
    return map
  }, [dayTabs])

  const tripMonths = useMemo(() => {
    const months = Array.from(
      new Set(dayTabs.map((d) => d.isoDate?.slice(0, 7)).filter((m): m is string => Boolean(m))),
    ).sort()
    return months
  }, [dayTabs])

  useEffect(() => {
    if (activeDayContext.isoDate) {
      setCalendarMonth(activeDayContext.isoDate.slice(0, 7))
    } else if (tripMonths.length > 0) {
      setCalendarMonth(tripMonths[0])
    }
  }, [activeDayContext.isoDate, tripMonths])

  useEffect(() => {
    if (!calendarOpen) return
    function handleOutside(e: MouseEvent) {
      if (calendarPopoverRef.current && !calendarPopoverRef.current.contains(e.target as Node)) {
        setCalendarOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setCalendarOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [calendarOpen])

  const activeHotelOrigin = useMemo<HotelOrigin | undefined>(() => {
    const dest = activeDayContext.isLocationChange
      ? activeDayContext.previousDestination ?? activeDayContext.destination
      : activeDayContext.destination
    if (!dest) return undefined
    const lat = dest.lodgingLat ?? dest.lat
    const lng = dest.lodgingLng ?? dest.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') return undefined
    return {
      name: dest.lodgingName || dest.name,
      lat,
      lng,
    }
  }, [activeDayContext])

  const schedule = useMemo(
    () => computeDaySchedule(dayStops, 9 * 60, activeHotelOrigin),
    [dayStops, activeHotelOrigin],
  )

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
    setRefreshGeocode(false)
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
    setRefreshGeocode(false)
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
        transportOverridden: true,
        estimatedCost: estimatedCost ? Math.max(0, Number(estimatedCost)) : undefined,
        bestLightWindow,
        photoTip: photoTip.trim() || undefined,
        notes: notes.trim() || undefined,
        ...(editingStop && refreshGeocode ? { refreshGeocode: true } : {}),
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

  const activeIsMoving = activeDayContext.isLocationChange || activeDayContext.isHotelChange
  const activeMonthKey = calendarMonth || tripMonths[0] || ''
  const calendarMonthIndex = tripMonths.indexOf(activeMonthKey)

  const monthCells = useMemo(() => {
    if (!activeMonthKey || !/^\d{4}-\d{2}$/.test(activeMonthKey)) return []
    const [yrStr, moStr] = activeMonthKey.split('-')
    const year = Number(yrStr)
    const monthZero = Number(moStr) - 1
    const firstWeekday = new Date(Date.UTC(year, monthZero, 1)).getUTCDay()
    const daysInMonth = new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate()

    const cells: Array<{ key: string; dayOfMonth: number | null; isoDate?: string }> = []
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ key: `pad-${i}`, dayOfMonth: null })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const isoDate = `${yrStr}-${moStr}-${String(d).padStart(2, '0')}`
      cells.push({ key: isoDate, dayOfMonth: d, isoDate })
    }
    return cells
  }, [activeMonthKey])

  const monthTitle = useMemo(() => {
    if (!activeMonthKey || !/^\d{4}-\d{2}$/.test(activeMonthKey)) return ''
    const [yr, mo] = activeMonthKey.split('-').map(Number)
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(yr, mo - 1, 1)))
  }, [activeMonthKey])

  return (
    <div className="flex flex-col gap-4">
      {/* Single Day Card + Left / Calendar / Right Controls & Action Buttons */}
      <div className="flex flex-col gap-3">
        <div className="relative" ref={calendarPopoverRef}>
          <div
            data-testid="day-selector-card"
            className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
              activeIsMoving
                ? 'border-amber-500 bg-card ring-1 ring-amber-500/30'
                : 'border-border bg-card'
            }`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground" data-testid="active-day-date">
                  {activeDayContext.shortDateLabel}
                </span>
                {activeIsMoving && (
                  <span className="rounded border border-amber-500/60 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                    Move
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {activeDayContext.isLocationChange && activeDayContext.previousDestination
                  ? `${activeDayContext.previousDestination.name} → ${activeDayContext.destination?.name ?? ''}`
                  : activeDayContext.destination?.name ?? `Day ${dayNumber}`}
                {` · ${dayStops.length} ${dayStops.length === 1 ? 'stop' : 'stops'}`}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="icon"
                className="size-8"
                variant="outline"
                aria-label="Previous day"
                data-testid="day-prev-btn"
                disabled={dayNumber <= 1}
                onClick={() => {
                  setCalendarOpen(false)
                  onSelectDay(Math.max(1, dayNumber - 1))
                }}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                className="size-8"
                variant={calendarOpen ? 'default' : 'outline'}
                aria-label="Open calendar date picker"
                aria-expanded={calendarOpen}
                data-testid="day-calendar-btn"
                onClick={() => setCalendarOpen((prev) => !prev)}
              >
                <Calendar className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                className="size-8"
                variant="outline"
                aria-label="Next day"
                data-testid="day-next-btn"
                disabled={dayNumber >= totalDays}
                onClick={() => {
                  setCalendarOpen(false)
                  onSelectDay(Math.min(totalDays, dayNumber + 1))
                }}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>

          {calendarOpen && (
            <div
              role="dialog"
              aria-label="Select trip date"
              data-testid="day-calendar-popover"
              className="absolute right-0 left-0 z-30 mt-2 rounded-xl border border-border bg-card p-3.5 shadow-xl sm:left-auto sm:w-80"
            >
              {validDateMap.size > 0 && monthCells.length > 0 ? (
                <div>
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      size="icon"
                      className="size-7"
                      variant="ghost"
                      aria-label="Previous month"
                      disabled={calendarMonthIndex <= 0}
                      onClick={() =>
                        calendarMonthIndex > 0 &&
                        setCalendarMonth(tripMonths[calendarMonthIndex - 1])
                      }
                    >
                      <ChevronLeft className="size-3.5" aria-hidden />
                    </Button>
                    <span className="text-xs font-semibold text-foreground">{monthTitle}</span>
                    <Button
                      type="button"
                      size="icon"
                      className="size-7"
                      variant="ghost"
                      aria-label="Next month"
                      disabled={calendarMonthIndex === -1 || calendarMonthIndex >= tripMonths.length - 1}
                      onClick={() =>
                        calendarMonthIndex >= 0 &&
                        calendarMonthIndex < tripMonths.length - 1 &&
                        setCalendarMonth(tripMonths[calendarMonthIndex + 1])
                      }
                    >
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Button>
                  </div>

                  <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
                    <span>Su</span>
                    <span>Mo</span>
                    <span>Tu</span>
                    <span>We</span>
                    <span>Th</span>
                    <span>Fr</span>
                    <span>Sa</span>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {monthCells.map((cell) => {
                      if (!cell.dayOfMonth || !cell.isoDate) {
                        return <div key={cell.key} className="h-9" />
                      }
                      const ctx = validDateMap.get(cell.isoDate)
                      if (!ctx) {
                        return (
                          <div
                            key={cell.key}
                            aria-disabled="true"
                            className="flex h-9 items-center justify-center rounded-md text-xs text-muted-foreground/30"
                          >
                            {cell.dayOfMonth}
                          </div>
                        )
                      }
                      const isSelected = ctx.dayNumber === dayNumber
                      const isMoving = ctx.isLocationChange || ctx.isHotelChange
                      const stopCount = stops.filter((s) => s.dayNumber === ctx.dayNumber).length
                      return (
                        <button
                          key={cell.key}
                          type="button"
                          data-testid={`calendar-day-${ctx.dayNumber}`}
                          title={`${ctx.fullDateLabel}${ctx.destination ? ` · ${ctx.destination.name}` : ''}${isMoving ? ' (Move day)' : ''}`}
                          onClick={() => {
                            onSelectDay(ctx.dayNumber)
                            setCalendarOpen(false)
                          }}
                          className={`relative flex h-9 flex-col items-center justify-center rounded-md border text-xs font-medium transition-colors ${
                            isSelected
                              ? isMoving
                                ? 'border-amber-500 bg-primary text-primary-foreground ring-1 ring-amber-500/50'
                                : 'border-primary bg-primary text-primary-foreground'
                              : isMoving
                                ? 'border-amber-500 bg-amber-500/10 text-foreground ring-1 ring-amber-500/35 hover:bg-amber-500/20'
                                : 'border-border bg-background text-foreground hover:bg-muted'
                          }`}
                        >
                          <span>{cell.dayOfMonth}</span>
                          {(stopCount > 0 || isMoving) && (
                            <span
                              className={`h-1 w-1 rounded-full ${
                                isSelected
                                  ? 'bg-primary-foreground'
                                  : isMoving
                                    ? 'bg-amber-500'
                                    : 'bg-primary'
                              }`}
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground">Select trip day</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {dayTabs.map((ctx) => {
                      const isSelected = ctx.dayNumber === dayNumber
                      const isMoving = ctx.isLocationChange || ctx.isHotelChange
                      return (
                        <button
                          key={ctx.dayNumber}
                          type="button"
                          data-testid={`calendar-day-${ctx.dayNumber}`}
                          onClick={() => {
                            onSelectDay(ctx.dayNumber)
                            setCalendarOpen(false)
                          }}
                          className={`flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                            isSelected
                              ? isMoving
                                ? 'border-amber-500 bg-primary text-primary-foreground ring-1 ring-amber-500/50'
                                : 'border-primary bg-primary text-primary-foreground'
                              : isMoving
                                ? 'border-amber-500 bg-amber-500/10 text-foreground ring-1 ring-amber-500/35 hover:bg-amber-500/20'
                                : 'border-border bg-background text-foreground hover:bg-muted'
                          }`}
                        >
                          <span>{ctx.shortDateLabel}</span>
                          {ctx.destination?.name && (
                            <span className="max-w-full truncate text-[10px] opacity-75">
                              {ctx.destination.name}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
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
              Optimize Route
            </Button>
          )}
          {onAskAi && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const isMoving =
                  (activeDayContext.isLocationChange || activeDayContext.isHotelChange) &&
                  activeDayContext.previousDestination &&
                  activeDayContext.destination
                const prompt = isMoving
                  ? `Fill ${activeDayContext.shortDateLabel} (Day ${dayNumber}, travel day moving from ${activeDayContext.previousDestination!.name} checkout ${activeDayContext.previousDestination!.checkOutTime || '10:00'} to ${activeDayContext.destination!.name} check-in ${activeDayContext.destination!.checkInTime || '15:00'}) with 3 well-paced stops and nearby photography viewpoints. Keep the existing Check out, Travel, and Check in cards in place without moving or resetting their times.`
                  : `Fill ${activeDayContext.shortDateLabel} (Day ${dayNumber}${activeDayContext.destination ? ` in ${activeDayContext.destination.name}` : ''}) with 3 well-paced stops, automatically pairing nearby photography viewpoints and accounting for ${activeDayContext.destination?.lodgingName ? `staying at ${activeDayContext.destination.lodgingName}` : 'transit times'}.`
                onAskAi(prompt)
              }}
            >
              <Sparkles className="size-3.5 text-primary" aria-hidden />
              AI Fill {activeDayContext.shortDateLabel}
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

      {/* Transition Day Callout (Location / Hotel Change) */}
      {(activeDayContext.isLocationChange || activeDayContext.isHotelChange) &&
        activeDayContext.previousDestination &&
        activeDayContext.destination && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500 bg-card px-3.5 py-2.5 text-xs text-foreground ring-1 ring-amber-500/25">
            <BedDouble className="size-4 shrink-0 text-amber-500" aria-hidden />
            <span className="font-semibold">Location &amp; Hotel Change:</span>
            <span className="text-muted-foreground">
              Check out{' '}
              <strong className="text-foreground">
                {activeDayContext.previousDestination.lodgingName ||
                  activeDayContext.previousDestination.name}
              </strong>{' '}
              ({activeDayContext.previousDestination.checkOutTime || '10:00'})
            </span>
            <ArrowRight className="size-3.5 text-primary" aria-hidden />
            <span className="text-muted-foreground">
              Check in{' '}
              <strong className="text-foreground">
                {activeDayContext.destination.lodgingName || activeDayContext.destination.name}
              </strong>{' '}
              ({activeDayContext.destination.checkInTime || '15:00'})
            </span>
          </div>
        )}

      {/* Day Summary Strip */}
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-3 text-xs">
        <div>
          <span className="text-muted-foreground">Date</span>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
            {activeDayContext.shortDateLabel}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Transit</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {formatMinutesHuman(schedule.totalTravelMinutes)} ({schedule.totalDistanceKm.toFixed(1)} km)
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Activities</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {(schedule.totalActivityMinutes / 60).toFixed(1)} hrs ({schedule.items.length})
          </p>
        </div>
      </div>

      {/* Warnings */}
      {schedule.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-card p-3">
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
          title={`${activeDayContext.shortDateLabel} has no stops yet`}
          description="Add sights, restaurants, hotel transfers, or photo viewpoints—or ask the AI Concierge to draft this day with nearby viewpoints."
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
                    `Plan ${activeDayContext.shortDateLabel} (Day ${dayNumber}) with well-paced stops, lunch, and nearby photo spots.`,
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

            const isDone =
              isActiveToday && liveNowMinutes !== undefined && item.endMinutes < liveNowMinutes
            const isNow =
              isActiveToday &&
              liveNowMinutes !== undefined &&
              item.startMinutes <= liveNowMinutes &&
              liveNowMinutes <= item.endMinutes
            const isNext =
              isActiveToday &&
              liveNowMinutes !== undefined &&
              !isDone &&
              !isNow &&
              schedule.items
                .slice(0, idx)
                .every((prevItem) => prevItem.endMinutes < liveNowMinutes || (prevItem.startMinutes <= liveNowMinutes && liveNowMinutes <= prevItem.endMinutes))

            return (
              <div key={stop.id} className="flex flex-col">
                {(idx > 0 || item.fromHotelOrigin) && item.travelMinutesFromPrev > 0 && (
                  <div className="ml-5 flex flex-wrap items-center gap-2 border-l border-dashed border-border py-2 pl-4 text-[11px] text-muted-foreground">
                    <Clock className="size-3 text-primary" aria-hidden />
                    {isIntercityLegCard(stop) ? (
                      <span>
                        {formatMinutesHuman(item.travelMinutesFromPrev)} to departure{' '}
                        {item.effectiveTransportMode === 'flight' ? 'airport' : 'station'} ·{' '}
                        {item.travelDistanceKmFromPrev.toFixed(1)} km
                      </span>
                    ) : (
                      <>
                        <span>
                          {formatMinutesHuman(item.travelMinutesFromPrev)}
                          {item.fromHotelOrigin && activeHotelOrigin?.name
                            ? ` from ${activeHotelOrigin.name}`
                            : ''}{' '}
                          · {item.travelDistanceKmFromPrev.toFixed(1)} km
                        </span>
                        {canEdit ? (
                          <select
                            aria-label={`Transit mode for ${stop.title}`}
                            data-testid={`leg-transport-select-${idx}`}
                            value={item.effectiveTransportMode}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const nextMode = e.target.value as TransportMode
                              void onSaveStop({
                                stopId: stop.id,
                                dayNumber,
                                title: stop.title,
                                category: stop.category,
                                transportMode: nextMode,
                                transportOverridden: true,
                              })
                            }}
                            className="h-6 rounded border border-border bg-card px-1.5 text-[11px] font-medium text-foreground hover:border-primary/60"
                          >
                            {Object.entries(TRANSPORT_ITEMS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                            {TRANSPORT_MODE_LABELS[item.effectiveTransportMode]}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div
                  onClick={() => onSelectStop?.(stop.id)}
                  data-testid={`stop-card-${idx}`}
                  className={`group rounded-lg border p-3.5 transition-colors ${isNow
                    ? 'border-primary bg-accent/50'
                    : selected
                      ? 'border-primary bg-accent/35'
                      : isDone
                        ? 'border-border/60 bg-card/60 opacity-75'
                        : 'border-border bg-card hover:border-primary/50'
                    }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-[180px] flex-1 items-start gap-2.5 sm:gap-3">
                      <span
                        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-primary-foreground"
                        style={{ backgroundColor: meta.color }}
                        data-testid={`stop-badge-${idx}`}
                      >
                        {isCheckInOrOutStop(stop) ? (
                          <BedDouble className="size-3.5" aria-label="Hotel" />
                        ) : (
                          idx + 1
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                          <span className="font-mono font-medium text-primary">
                            {item.startTime}–{item.endTime}
                          </span>
                          <span className="rounded-[4px] bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {meta.label}
                          </span>
                          {stop.fixedTime && (
                            <span className="text-[11px] text-muted-foreground">· Fixed time</span>
                          )}
                          {isNow && (
                            <span className="font-semibold text-primary">· Now</span>
                          )}
                          {isNext && (
                            <span className="font-semibold text-foreground">· Up next</span>
                          )}
                          {typeof stop.rating === 'number' && stop.rating > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              · ★ {stop.rating.toFixed(1)}
                            </span>
                          )}
                          {typeof stop.estimatedCost === 'number' && stop.estimatedCost > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              · {currency} {stop.estimatedCost}
                            </span>
                          )}
                        </div>

                        <h4 className="mt-1 text-sm font-semibold text-foreground">{stop.title}</h4>

                        {isIntercityLegCard(stop) && (
                          <div
                            className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="inline-flex items-center gap-1 font-medium text-foreground">
                              <Route className="size-3.5 text-primary" aria-hidden />
                              {formatMinutesHuman(item.endMinutes - item.startMinutes)}
                              {typeof item.transitCardDistanceKm === 'number' &&
                                item.transitCardDistanceKm > 0
                                ? ` · ${item.transitCardDistanceKm.toFixed(1)} km`
                                : ''}
                            </span>
                            {canEdit ? (
                              <select
                                aria-label={`Transit mode for ${stop.title}`}
                                data-testid={`leg-transport-select-${idx}`}
                                value={item.effectiveTransportMode}
                                onChange={(e) => {
                                  const nextMode = e.target.value as TransportMode
                                  void onSaveStop({
                                    stopId: stop.id,
                                    dayNumber,
                                    title: stop.title,
                                    category: stop.category,
                                    transportMode: nextMode,
                                    transportOverridden: true,
                                  })
                                }}
                                className="h-7 rounded border border-border bg-background px-2 text-xs font-medium text-foreground hover:border-primary/60"
                              >
                                {Object.entries(TRANSPORT_ITEMS).map(([k, label]) => (
                                  <option key={k} value={k}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                                {TRANSPORT_MODE_LABELS[item.effectiveTransportMode]}
                              </span>
                            )}
                          </div>
                        )}

                        {stop.address && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{stop.address}</span>
                          </p>
                        )}

                        {(stop.bestLightWindow && stop.bestLightWindow !== 'any') || stop.photoTip ? (
                          <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs">
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
                        className="flex shrink-0 items-center gap-0.5 sm:gap-1"
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
            {editingStop ? 'Edit Stop' : `Add Stop · ${activeDayContext.shortDateLabel}`}
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

          <div className="grid gap-3 sm:grid-cols-2">
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
            {editingStop && editingStop.category !== 'lodging' && editingStop.category !== 'transit' && (
              <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={refreshGeocode}
                  onChange={(e) => setRefreshGeocode(e.target.checked)}
                  className="rounded border-border"
                />
                Re-lookup map pin coordinates on save
              </label>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
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

          <div className="grid gap-3 sm:grid-cols-2">
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
