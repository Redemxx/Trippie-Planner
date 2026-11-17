import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Navigation } from 'lucide-react'
import { CATEGORY_META, type DestinationData, type StopData } from '@/lib/trip-types'
import { hasCoords } from '@/lib/route-optimizer'
import { getActiveTheme } from '@/themes'

export interface MapStopItem extends StopData {
  id: string
}

interface AtlasMapProps {
  stops: MapStopItem[]
  destinations?: Array<DestinationData & { id?: string }>
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

function tileUrlFor(provider: 'carto' | 'osm', isLight: boolean): string {
  if (provider === 'carto') {
    const style = isLight ? 'light_all' : 'dark_all'
    return `/api/map-tiles/${style}/{z}/{x}/{y}`
  }
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
}

export function AtlasMap({
  stops,
  destinations = [],
  selectedStopId,
  onSelectStop,
  className = '',
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerGroupRef = useRef<import('leaflet').LayerGroup | null>(null)
  const [tileMode, setTileMode] = useState<'leaflet' | 'svg'>('leaflet')
  const [mapProvider, setMapProvider] = useState<'carto' | 'osm'>(cachedMapProvider ?? 'osm')
  const [themeVersion, setThemeVersion] = useState(0)

  const geoStops = useMemo(
    () => stops.filter((s): s is MapStopItem & { lat: number; lng: number } => hasCoords(s)),
    [stops],
  )
  const geoDests = useMemo(
    () => destinations.filter((d): d is DestinationData & { lat: number; lng: number } => hasCoords(d)),
    [destinations],
  )

  useEffect(() => {
    void resolveMapProvider().then((p) => setMapProvider(p))
  }, [])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const obs = new MutationObserver(() => setThemeVersion((v) => v + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const isLight = getActiveTheme() === 'cartographer'
  const useOsmDarkFilter = mapProvider === 'osm' && !isLight

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || !containerRef.current) return

    async function mountMap() {
      try {
        const L = await import('leaflet')
        await import('leaflet/dist/leaflet.css')
        if (cancelled || !containerRef.current) return

        const activeProvider = await resolveMapProvider()
        const lightTheme = getActiveTheme() === 'cartographer'
        const tileUrl = tileUrlFor(activeProvider, lightTheme)

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
          geoStops.length > 0
            ? geoStops.map((s) => [s.lat, s.lng] as [number, number])
            : geoDests.map((d) => [d.lat, d.lng] as [number, number])

        if (geoStops.length > 1) {
          L.polyline(
            geoStops.map((s) => [s.lat, s.lng]),
            {
              color: '#e5a93c',
              weight: 2.5,
              opacity: 0.9,
              dashArray: '6 6',
            },
          ).addTo(group)
        } else if (geoDests.length > 1 && geoStops.length === 0) {
          L.polyline(
            geoDests.map((d) => [d.lat, d.lng]),
            {
              color: '#38bdf8',
              weight: 2,
              opacity: 0.85,
              dashArray: '4 6',
            },
          ).addTo(group)
        }

        if (geoStops.length > 0) {
          geoStops.forEach((stop, index) => {
            const meta = CATEGORY_META[stop.category] ?? CATEGORY_META.must_see
            const isSelected = stop.id === selectedStopId
            const marker = L.marker([stop.lat, stop.lng], {
              icon: L.divIcon({
                className: 'trippie-pin',
                html: `<div style="width:${isSelected ? 30 : 24}px;height:${isSelected ? 30 : 24}px;border-radius:9999px;background:${meta.color};color:#090d14;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid #090d14;box-shadow:0 2px 8px rgba(0,0,0,0.45);transform:translate(-50%,-50%)">${index + 1}</div>`,
                iconSize: [0, 0],
              }),
            })
            marker.bindTooltip(`${index + 1}. ${stop.title}`, { direction: 'top' })
            marker.on('click', () => onSelectStop?.(stop.id))
            marker.addTo(group)
          })
        } else {
          geoDests.forEach((dest, index) => {
            const marker = L.marker([dest.lat, dest.lng], {
              icon: L.divIcon({
                className: 'trippie-pin',
                html: `<div style="width:26px;height:26px;border-radius:9999px;background:#e5a93c;color:#090d14;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid #090d14;box-shadow:0 2px 8px rgba(0,0,0,0.45);transform:translate(-50%,-50%)">${index + 1}</div>`,
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
          map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 14 })
        }
      } catch {
        if (!cancelled) setTileMode('svg')
      }
    }

    void mountMap()
    return () => {
      cancelled = true
    }
  }, [geoStops, geoDests, selectedStopId, onSelectStop, themeVersion, mapProvider])

  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      layerGroupRef.current = null
    }
  }, [])

  const hasAnyPoints = geoStops.length > 0 || geoDests.length > 0

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-border bg-card ${
        useOsmDarkFilter ? 'trippie-osm-dark' : ''
      } ${className}`}
      data-testid="atlas-map"
    >
      {tileMode === 'leaflet' ? (
        <div ref={containerRef} className="h-full min-h-[280px] w-full" />
      ) : (
        <SvgRouteFallback stops={geoStops} selectedStopId={selectedStopId} onSelectStop={onSelectStop} />
      )}

      {!hasAnyPoints && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-card/80 px-4 text-center">
          <MapPin className="mb-2 size-5 text-primary" aria-hidden />
          <p className="text-xs font-medium text-foreground">No mapped coordinates yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a stop or destination to plot route legs and transit pins.
          </p>
        </div>
      )}

      {hasAnyPoints && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex items-center gap-2 rounded-md border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
          <Navigation className="size-3 text-primary" aria-hidden />
          <span>
            {geoStops.length > 0
              ? `${geoStops.length} mapped stops`
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
  if (stops.length === 0) return <div className="h-full min-h-[280px] w-full bg-card" />
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
    <svg viewBox="0 0 400 280" className="h-full min-h-[280px] w-full bg-card">
      <polyline
        fill="none"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="2"
        strokeDasharray="5 5"
        points={pathStr}
      />
      {points.map((p, idx) => (
        <g key={p.id} onClick={() => onSelectStop?.(p.id)} className="cursor-pointer">
          <circle
            cx={p.x}
            cy={p.y}
            r={p.id === selectedStopId ? 13 : 10}
            className="fill-primary"
          />
          <text
            x={p.x}
            y={p.y + 4}
            textAnchor="middle"
            className="fill-primary-foreground text-[10px] font-bold"
          >
            {idx + 1}
          </text>
        </g>
      ))}
    </svg>
  )
}
