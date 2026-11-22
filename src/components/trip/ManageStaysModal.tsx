import { useState } from 'react'
import { BedDouble, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Label, Modal, useToast } from '@/components/ui'
import { INTERCITY_TRANSPORT_LABELS, type DestinationData, type IntercityTransport } from '@/lib/trip-types'
import { estimateIntercityTransit } from '@/lib/route-optimizer'

interface ManageStaysModalProps {
  open: boolean
  onClose: () => void
  destinations: Array<DestinationData & { id: string }>
  onAddStay: (payload: {
    name: string
    country?: string
    arrivalDate?: string
    departureDate?: string
    lodgingName?: string
    lodgingAddress?: string
    checkInTime: string
    checkOutTime: string
    transportFromPrev?: IntercityTransport
    seedStops?: boolean
  }) => Promise<void>
  onEditStay: (dest: DestinationData & { id: string }) => void
  onChangeTransit: (destinationId: string, mode: IntercityTransport | 'auto') => Promise<void>
  onClearHotel: (destinationId: string) => Promise<void>
  onRemoveStay: (destinationId: string) => Promise<void>
}

const INTERCITY_SELECT_OPTIONS: Array<{ value: IntercityTransport | 'auto'; label: string }> = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'bullet_train', label: 'Bullet train (Shinkansen / HSR)' },
  { value: 'train', label: 'Regional rail / Train' },
  { value: 'flight', label: 'Flight' },
  { value: 'drive', label: 'Car / Drive' },
  { value: 'bus', label: 'Bus / Coach' },
  { value: 'ferry', label: 'Ferry' },
]

export function ManageStaysModal({
  open,
  onClose,
  destinations,
  onAddStay,
  onEditStay,
  onChangeTransit,
  onClearHotel,
  onRemoveStay,
}: ManageStaysModalProps) {
  const { success, error } = useToast()
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [departureDate, setDepartureDate] = useState('')
  const [lodgingName, setLodgingName] = useState('')
  const [lodgingAddress, setLodgingAddress] = useState('')
  const [checkInTime, setCheckInTime] = useState('15:00')
  const [checkOutTime, setCheckOutTime] = useState('10:00')
  const [transportFromPrev, setTransportFromPrev] = useState<IntercityTransport | 'auto'>('auto')
  const [savingAdd, setSavingAdd] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const sorted = destinations.slice().sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))

  async function handleAddStay() {
    if (!city.trim()) {
      error('City required', 'Enter a destination city (e.g. Tokyo, Japan).')
      return
    }
    setSavingAdd(true)
    try {
      await onAddStay({
        name: city.trim(),
        country: country.trim() || undefined,
        arrivalDate: arrivalDate || undefined,
        departureDate: departureDate || undefined,
        lodgingName: lodgingName.trim() || undefined,
        lodgingAddress: lodgingAddress.trim() || undefined,
        checkInTime: checkInTime || '15:00',
        checkOutTime: checkOutTime || '10:00',
        transportFromPrev: transportFromPrev === 'auto' ? undefined : transportFromPrev,
        seedStops: true,
      })
      setCity('')
      setCountry('')
      setArrivalDate('')
      setDepartureDate('')
      setLodgingName('')
      setLodgingAddress('')
      setTransportFromPrev('auto')
      success('Stay added', `Added ${city.trim()} to your itinerary.`)
    } catch (err) {
      error('Could not add stay', err instanceof Error ? err.message : 'Failed')
    } finally {
      setSavingAdd(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <Modal.Header>
        <h3 className="text-base font-semibold text-foreground">Manage Hotels &amp; Stays</h3>
      </Modal.Header>
      <Modal.Body className="space-y-5">
        {/* Existing stays */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium text-muted-foreground">
            Current stays &amp; intercity transit ({sorted.length})
          </p>
          {sorted.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
              No destinations or hotel stays yet. Add one below.
            </p>
          ) : (
            sorted.map((dest, idx) => {
              const prevDest = idx > 0 ? sorted[idx - 1] : null
              const legEst = prevDest
                ? estimateIntercityTransit(
                    {
                      lat: prevDest.lodgingLat ?? prevDest.lat,
                      lng: prevDest.lodgingLng ?? prevDest.lng,
                    },
                    {
                      lat: dest.lodgingLat ?? dest.lat,
                      lng: dest.lodgingLng ?? dest.lng,
                    },
                    dest.transportFromPrev,
                  )
                : null
              const activeMode = dest.transportFromPrev && dest.transportFromPrev !== 'none'
                ? dest.transportFromPrev
                : legEst?.mode ?? 'train'
              const selectValue =
                !dest.transportFromPrev || dest.transportFromPrev === 'none'
                  ? 'auto'
                  : dest.transportFromPrev
              const hours = dest.transitHoursFromPrev ?? legEst?.hours ?? 0
              const isBusy = busyId === dest.id

              return (
                <div
                  key={dest.id}
                  data-testid={`manage-stay-row-${idx}`}
                  className="rounded-lg border border-border bg-background/60 p-3 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
                        <span>
                          {idx + 1}. {dest.name}
                          {dest.country ? `, ${dest.country}` : ''}
                        </span>
                      </div>
                      {dest.lodgingName ? (
                        <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                          <BedDouble className="size-3.5 shrink-0 text-primary" aria-hidden />
                          <span className="font-medium text-foreground">{dest.lodgingName}</span>
                          <span>
                            ({dest.checkInTime || '15:00'} in / {dest.checkOutTime || '10:00'} out)
                          </span>
                        </p>
                      ) : (
                        <p className="mt-1 text-muted-foreground">No hotel assigned yet</p>
                      )}
                      {dest.arrivalDate && dest.departureDate && (
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {dest.arrivalDate} → {dest.departureDate}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => {
                          onClose()
                          onEditStay(dest)
                        }}
                      >
                        <Pencil className="size-3" aria-hidden />
                        Edit
                      </Button>
                      {dest.lodgingName && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={async () => {
                            setBusyId(dest.id)
                            try {
                              await onClearHotel(dest.id)
                              success('Hotel cleared', `Removed lodging details for ${dest.name}.`)
                            } catch (err) {
                              error('Failed', err instanceof Error ? err.message : 'Could not clear hotel')
                            } finally {
                              setBusyId(null)
                            }
                          }}
                        >
                          Clear hotel
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        aria-label={`Remove ${dest.name} stay`}
                        onClick={async () => {
                          setBusyId(dest.id)
                          try {
                            await onRemoveStay(dest.id)
                            success('Stay removed', `Removed ${dest.name} and its hotel stops.`)
                          } catch (err) {
                            error('Failed', err instanceof Error ? err.message : 'Could not remove stay')
                          } finally {
                            setBusyId(null)
                          }
                        }}
                      >
                        <Trash2 className="size-3.5 text-destructive" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  {idx > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
                      <span className="text-[11px] text-muted-foreground">
                        Transit from {prevDest?.name}:{' '}
                        <strong className="text-foreground">
                          {INTERCITY_TRANSPORT_LABELS[activeMode] ?? activeMode}
                        </strong>
                        {hours > 0 ? ` (~${hours}h)` : ''}
                      </span>
                      <select
                        aria-label={`Transit method to ${dest.name}`}
                        disabled={isBusy}
                        value={selectValue}
                        onChange={async (e) => {
                          const mode = e.target.value as IntercityTransport | 'auto'
                          setBusyId(dest.id)
                          try {
                            await onChangeTransit(dest.id, mode)
                            success('Transit updated', `Updated travel to ${dest.name}.`)
                          } catch (err) {
                            error('Failed', err instanceof Error ? err.message : 'Could not update transit')
                          } finally {
                            setBusyId(null)
                          }
                        }}
                        className="h-7 rounded-md border border-input bg-card px-2 text-[11px] text-foreground"
                      >
                        {INTERCITY_SELECT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Add new stay form */}
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs font-semibold text-foreground">Add a destination or hotel stay</p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="add-stay-city">City / Destination</Label>
              <Input
                id="add-stay-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Tokyo, Japan"
              />
            </div>
            <div>
              <Label htmlFor="add-stay-country">Country (optional)</Label>
              <Input
                id="add-stay-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. JP"
              />
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="add-stay-hotel">Hotel / Lodging name</Label>
              <Input
                id="add-stay-hotel"
                value={lodgingName}
                onChange={(e) => setLodgingName(e.target.value)}
                placeholder="e.g. Park Hyatt Tokyo"
              />
            </div>
            <div>
              <Label htmlFor="add-stay-addr">Hotel address or ward</Label>
              <Input
                id="add-stay-addr"
                value={lodgingAddress}
                onChange={(e) => setLodgingAddress(e.target.value)}
                placeholder="e.g. Shinjuku, Tokyo"
              />
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-4">
            <div>
              <Label htmlFor="add-stay-arrive">Arrival date</Label>
              <Input
                id="add-stay-arrive"
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="add-stay-depart">Departure date</Label>
              <Input
                id="add-stay-depart"
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="add-stay-checkin">Check-in</Label>
              <Input
                id="add-stay-checkin"
                type="time"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="add-stay-checkout">Check-out</Label>
              <Input
                id="add-stay-checkout"
                type="time"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
              />
            </div>
          </div>

          {sorted.length > 0 && (
            <div>
              <Label htmlFor="add-stay-transit">Transit from {sorted[sorted.length - 1].name}</Label>
              <select
                id="add-stay-transit"
                value={transportFromPrev}
                onChange={(e) => setTransportFromPrev(e.target.value as IntercityTransport | 'auto')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-xs text-foreground"
              >
                {INTERCITY_SELECT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end">
            <Button size="sm" loading={savingAdd} onClick={handleAddStay} data-testid="add-stay-submit-btn">
              <Plus className="size-3.5" aria-hidden />
              Add Stay
            </Button>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
