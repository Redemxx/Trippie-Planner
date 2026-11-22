import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Maximize2, Minimize2, Navigation } from 'lucide-react'
import { CATEGORY_META, type DestinationData, type StopData } from '@/lib/trip-types'
import {
  buildDayMapGeometry,
  hasCoords,
  isCheckInOrOutStop,
  type MapHotelInput,
} from '@/lib/route-optimizer'

const HOTEL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/></svg>'

export interface MapStopItem extends StopData {
  id: string
}

interface AtlasMapProps {
  stops: MapStopItem[]
  destinations?: Array<DestinationData & { id?: string }>
  startHotel?: MapHotelInput | null
  endHotel?: MapHotelInput | null
  selectedStopId?: string | null
  onSelectStop?: (stopId: string) => void
  className?: string
}

let cachedMapProvider: 'carto' | 'osm' | null = null

async function resolveMapProvider(): Promise<'carto' | 'osm'> {
  if (cachedMapProvider) return cachedMapProvider
  try {
    const res = await fetch('/api/map-config')
    if (res.ok) {
      const data = (await res.json()) as { provider?: string }
      if (data.provider === 'carto') {
        cachedMapProvider = 'carto'
        return 'carto'
      }
    }
  } catch {
    // Fall back to OpenStreetMap (no API key required)
  }
  cachedMapProvider = 'osm'
  return 'osm'
}

function tileUrlFor(provider: 'carto' | 'osm'): string {
  if (provider === 'carto') {
    return '/api/map-tiles/voyager/{z}/{x}/{y}'
  }
  // OpenStreetMap standard light roadmap tiles (clean bright parks, water, highways)
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
}

export function AtlasMap({
  stops,
  destinations = [],
  startHotel = null,
  endHotel = null,
  selectedStopId,
  onSelectStop,
  className = '',
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerGroupRef = useRef<import('leaflet').LayerGroup | null>(null)
  const [tileMode, setTileMode] = useState<'leaflet' | 'svg'>('leaflet')
  const [mapProvider, setMapProvider] = useState<'carto' | 'osm'>(cachedMapProvider ?? 'osm')
  const [expanded, setExpanded] = useState(false)

  const geoStops = useMemo(
    () => stops.filter((s): s is MapStopItem & { lat: number; lng: number } => hasCoords(s)),
    [stops],
  )
  const geoDests = useMemo(
    () => destinations.filter((d): d is DestinationData & { lat: number; lng: number } => hasCoords(d)),
    [destinations],
  )
  const mapGeom = useMemo(
    () => buildDayMapGeometry(geoStops, startHotel, endHotel),
    [geoStops, startHotel, endHotel],
  )

  useEffect(() => {
    void resolveMapProvider().then((p) => setMapProvider(p))
  }, [])

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || !containerRef.current) return

    async function mountMap() {
      try {
        const L = await import('leaflet')
        await import('leaflet/dist/leaflet.css')
        if (cancelled || !containerRef.current) return

        const activeProvider = await resolveMapProvider()
        const tileUrl = tileUrlFor(activeProvider)

        if (!mapRef.current) {
          const map = L.map(containerRef.current, {
            zoomControl: true,
            attributionControl: false,
          }).setView([35.0116, 135.7681], 12)

          const tileLayer = L.tileLayer(tileUrl, {
            maxZoom: 19,
          })
          tileLayer.addTo(map)
          layerGroupRef.current = L.layerGroup().addTo(map)
          mapRef.current = map
        } else {
          const map = mapRef.current
          map.invalidateSize()
          map.eachLayer((layer) => {
            if ('setUrl' in layer && typeof (layer as import('leaflet').TileLayer).setUrl === 'function') {
              ;(layer as import('leaflet').TileLayer).setUrl(tileUrl)
            }
          })
        }

        const group = layerGroupRef.current
        const map = mapRef.current
        if (!group || !map) return

        group.clearLayers()

        const pts =
          mapGeom.boundsPoints.length > 0
            ? mapGeom.boundsPoints
            : geoDests.map((d) => [d.lat, d.lng] as [number, number])

        if (mapGeom.routePoints.length > 1) {
          // Google Maps-style crisp white route halo + blue direction stroke
          L.polyline(mapGeom.routePoints, {
            color: '#ffffff',
            weight: 6.5,
            opacity: 0.92,
          }).addTo(group)
          L.polyline(mapGeom.routePoints, {
            color: '#1a73e8',
            weight: 3.5,
            opacity: 0.95,
          }).addTo(group)
        } else if (geoDests.length > 1 && geoStops.length === 0) {
          L.polyline(
            geoDests.map((d) => [d.lat, d.lng]),
            {
              color: '#1a73e8',
              weight: 2.5,
              opacity: 0.85,
              dashArray: '6 6',
            },
          ).addTo(group)
        }

        // Render active hotel marker(s) for the day (skipping duplicates if a Check in/out stop card sits at the same spot)
        for (const h of mapGeom.hotels) {
          const coveredByCheckStop = geoStops.some(
            (s) =>
              isCheckInOrOutStop(s) &&
              Math.abs(s.lat - h.lat) < 0.0005 &&
              Math.abs(s.lng - h.lng) < 0.0005,
          )
          if (coveredByCheckStop) continue

          const rolePrefix =
            h.role === 'checkout'
              ? 'Check-out Hotel'
              : h.role === 'checkin'
                ? 'Check-in Hotel'
                : 'Hotel'
          const hotelColor = h.role === 'checkout' ? '#d97706' : CATEGORY_META.lodging.color
          const hotelMarker = L.marker([h.lat, h.lng], {
            icon: L.divIcon({
              className: 'trippie-hotel-pin',
              html: `<div style="width:26px;height:26px;border-radius:9999px;background:${hotelColor};color:#ffffff;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.4);transform:translate(-50%,-50%)">${HOTEL_ICON_SVG}</div>`,
              iconSize: [0, 0],
            }),
          })
          hotelMarker.bindTooltip(`${rolePrefix}: ${h.name}`, { direction: 'top' })
          hotelMarker.addTo(group)
        }

        if (geoStops.length > 0) {
          geoStops.forEach((stop, index) => {
            const meta = CATEGORY_META[stop.category] ?? CATEGORY_META.must_see
            const isSelected = stop.id === selectedStopId
            const isHotelCard = isCheckInOrOutStop(stop)
            const pinBg = meta.color
            const pinText =
              stop.category === 'lodging' || stop.category === 'transit' ? '#ffffff' : '#131313'
            const pinRing = isSelected
              ? 'box-shadow:0 0 0 3px #1a73e8,0 2px 8px rgba(0,0,0,0.45);'
              : 'box-shadow:0 2px 8px rgba(0,0,0,0.35);'
            const pinContent = isHotelCard ? HOTEL_ICON_SVG : String(index + 1)
            const marker = L.marker([stop.lat, stop.lng], {
              icon: L.divIcon({
                className: 'trippie-pin',
                html: `<div style="width:${isSelected ? 32 : 26}px;height:${isSelected ? 32 : 26}px;border-radius:9999px;background:${pinBg};color:${pinText};font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;border:2.5px solid #ffffff;${pinRing}transform:translate(-50%,-50%)">${pinContent}</div>`,
                iconSize: [0, 0],
              }),
            })
            marker.bindTooltip(isHotelCard ? stop.title : `${index + 1}. ${stop.title}`, {
              direction: 'top',
            })
            marker.on('click', () => onSelectStop?.(stop.id))
            marker.addTo(group)
          })
        } else if (mapGeom.hotels.length === 0) {
          geoDests.forEach((dest, index) => {
            const marker = L.marker([dest.lat, dest.lng], {
              icon: L.divIcon({
                className: 'trippie-pin',
                html: `<div style="width:28px;height:28px;border-radius:9999px;background:#ea4335;color:#ffffff;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);transform:translate(-50%,-50%)">${index + 1}</div>`,
                iconSize: [0, 0],
              }),
            })
            marker.bindTooltip(dest.name, { direction: 'top' })
            marker.addTo(group)
          })
        }

        if (pts.length === 1) {
          map.setView(pts[0], 13)
        } else if (pts.length > 1) {
          map.fitBounds(L.latLngBounds(pts), { padding: [44, 44], maxZoom: 14 })
        }
      } catch {
        if (!cancelled) setTileMode('svg')
      }
    }

    void mountMap()
    return () => {
      cancelled = true
    }
  }, [geoStops, geoDests, mapGeom, selectedStopId, onSelectStop, mapProvider, expanded])

  useEffect(() => {
    if (!mapRef.current) return
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 120)
    return () => window.clearTimeout(timer)
  }, [expanded])

  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      layerGroupRef.current = null
    }
  }, [])

  const hasAnyPoints = geoStops.length > 0 || mapGeom.hotels.length > 0 || geoDests.length > 0

  return (
    <div
      className={`trippie-gmaps-canvas overflow-hidden border border-[#dadce0] bg-[#e8eaed] ${
        expanded
          ? 'fixed inset-3 z-50 rounded-xl shadow-2xl'
          : `relative rounded-xl ${className}`
      }`}
      data-testid="atlas-map"
    >
      {tileMode === 'leaflet' ? (
        <div ref={containerRef} className="h-full min-h-[340px] w-full" />
      ) : (
        <SvgRouteFallback stops={geoStops} selectedStopId={selectedStopId} onSelectStop={onSelectStop} />
      )}

      {!hasAnyPoints && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[#f8f9fa]/90 px-4 text-center">
          <MapPin className="mb-2 size-5 text-[#1a73e8]" aria-hidden />
          <p className="text-xs font-semibold text-[#202124]">No mapped coordinates yet</p>
          <p className="mt-1 text-xs text-[#5f6368]">
            Add a stop or destination to plot route legs and transit pins.
          </p>
        </div>
      )}

      <div className="absolute top-3 right-3 z-[400] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-label={expanded ? 'Exit full map' : 'Expand map'}
          title={expanded ? 'Exit full map' : 'Expand map'}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#dadce0] bg-white/95 px-2.5 text-xs font-medium text-[#3c4043] shadow-sm transition-colors hover:bg-[#f1f3f4]"
        >
          {expanded ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
          <span className="hidden sm:inline">{expanded ? 'Collapse' : 'Expand'}</span>
        </button>
      </div>

      {hasAnyPoints && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex items-center gap-2 rounded-md border border-[#dadce0] bg-white/95 px-2.5 py-1 text-[11px] font-medium text-[#3c4043] shadow-sm">
          <Navigation className="size-3 text-[#1a73e8]" aria-hidden />
          <span>
            {geoStops.length > 0
              ? `${geoStops.length} mapped stops${mapGeom.hotels.length > 0 ? ` · ${mapGeom.hotels.length} hotel${mapGeom.hotels.length > 1 ? 's' : ''}` : ''}`
              : mapGeom.hotels.length > 0
                ? `${mapGeom.hotels.length} hotel${mapGeom.hotels.length > 1 ? 's' : ''}`
                : `${geoDests.length} destinations`}
          </span>
        </div>
      )}
    </div>
  )
}

function SvgRouteFallback({
  stops,
  selectedStopId,
  onSelectStop,
}: {
  stops: Array<MapStopItem & { lat: number; lng: number }>
  selectedStopId?: string | null
  onSelectStop?: (id: string) => void
}) {
  if (stops.length === 0) return <div className="h-full min-h-[340px] w-full bg-[#e8eaed]" />
  const lats = stops.map((s) => s.lat)
  const lngs = stops.map((s) => s.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const padLat = Math.max(0.01, (maxLat - minLat) * 0.25)
  const padLng = Math.max(0.01, (maxLng - minLng) * 0.25)

  const proj = (lat: number, lng: number) => ({
    x: 40 + ((lng - (minLng - padLng)) / (maxLng - minLng + 2 * padLng)) * 320,
    y: 240 - ((lat - (minLat - padLat)) / (maxLat - minLat + 2 * padLat)) * 200,
  })

  const points = stops.map((s) => ({ ...s, ...proj(s.lat, s.lng) }))
  const pathStr = points.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <svg viewBox="0 0 400 280" className="h-full min-h-[340px] w-full bg-[#f1f3f4]">
      <polyline fill="none" stroke="#ffffff" strokeWidth="5" points={pathStr} />
      <polyline fill="none" stroke="#1a73e8" strokeWidth="2.5" points={pathStr} />
      {points.map((p, idx) => {
        const meta = CATEGORY_META[p.category] ?? CATEGORY_META.must_see
        const isSelected = p.id === selectedStopId
        const isHotelCard = isCheckInOrOutStop(p)
        const textColor =
          p.category === 'lodging' || p.category === 'transit' ? '#ffffff' : '#131313'
        return (
          <g key={p.id} onClick={() => onSelectStop?.(p.id)} className="cursor-pointer">
            <circle
              cx={p.x}
              cy={p.y}
              r={isSelected ? 13 : 10}
              fill={meta.color}
              stroke={isSelected ? '#1a73e8' : '#ffffff'}
              strokeWidth={isSelected ? '3' : '2'}
            />
            {isHotelCard ? (
              <g
                transform={`translate(${p.x - 6}, ${p.y - 6}) scale(0.5)`}
                fill="none"
                stroke={textColor}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
                <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
                <path d="M12 4v6" />
                <path d="M2 18h20" />
              </g>
            ) : (
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                fill={textColor}
                className="text-[10px] font-bold"
              >
                {idx + 1}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
