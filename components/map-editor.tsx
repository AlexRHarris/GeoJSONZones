"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "leaflet-draw"
import "leaflet-draw/dist/leaflet.draw.css"
import * as turf from "@turf/turf"
import {
  Map,
  Layers,
  Download,
  Upload,
  Trash2,
  Maximize2,
  Scissors,
  FileJson,
  Copy,
  Settings,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
} from "lucide-react"

interface Zone {
  id: string
  name: string
  color: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  properties: Record<string, unknown>
}

const ZONE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
]

const RING_COLORS = [
  ["#1e40af", "#3b82f6", "#93c5fd"],
  ["#065f46", "#10b981", "#6ee7b7"],
  ["#92400e", "#f59e0b", "#fcd34d"],
]

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}

export default function MapEditor() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [zones, setZones] = useState<Zone[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.001)
  const [showSettings, setShowSettings] = useState(false)
  const [showDriveTime, setShowDriveTime] = useState(false)
  const [driveTimeMinutes, setDriveTimeMinutes] = useState<number[]>([5, 10, 15])
  const [isPlacingMarker, setIsPlacingMarker] = useState(false)

  // Calculate stats
  const stats = {
    totalZones: zones.length,
    totalArea: zones.reduce((acc, z) => {
      try {
        return acc + turf.area(turf.feature(z.geometry)) / 1_000_000
      } catch {
        return acc
      }
    }, 0),
  }

  // Split polygon using line - creates two half-planes and intersects
  const splitPolygonWithLine = useCallback((
    polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    lineCoords: [number, number][]
  ): GeoJSON.Polygon[] => {
    if (lineCoords.length < 2) return []

    try {
      const poly = turf.feature(polygon)
      const line = turf.lineString(lineCoords)

      // Check if line intersects polygon
      if (!turf.booleanIntersects(line, poly)) {
        return []
      }

      // Get bounding box and extend
      const bbox = turf.bbox(poly)
      const bboxPoly = turf.bboxPolygon(bbox)
      const buffered = turf.buffer(bboxPoly, 10, { units: "kilometers" })
      if (!buffered) return []
      
      const bigBbox = turf.bbox(buffered)
      const size = Math.max(bigBbox[2] - bigBbox[0], bigBbox[3] - bigBbox[1]) * 2

      // Get line direction
      const start = lineCoords[0]
      const end = lineCoords[lineCoords.length - 1]
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len === 0) return []

      const ux = dx / len
      const uy = dy / len
      const perpX = -uy
      const perpY = ux

      // Extend line
      const extStart: [number, number] = [start[0] - ux * size, start[1] - uy * size]
      const extEnd: [number, number] = [end[0] + ux * size, end[1] + uy * size]

      // Create two half-plane polygons
      const halfPlane1: [number, number][] = [
        extStart,
        extEnd,
        [extEnd[0] + perpX * size, extEnd[1] + perpY * size],
        [extStart[0] + perpX * size, extStart[1] + perpY * size],
        extStart,
      ]

      const halfPlane2: [number, number][] = [
        extStart,
        extEnd,
        [extEnd[0] - perpX * size, extEnd[1] - perpY * size],
        [extStart[0] - perpX * size, extStart[1] - perpY * size],
        extStart,
      ]

      const results: GeoJSON.Polygon[] = []

      // Intersect with each half-plane
      for (const hp of [halfPlane1, halfPlane2]) {
        try {
          const halfPlanePoly = turf.polygon([hp])
          const intersection = turf.intersect(
            turf.featureCollection([poly, halfPlanePoly])
          )

          if (intersection) {
            if (intersection.geometry.type === "Polygon") {
              const area = turf.area(intersection)
              if (area > 100) {
                results.push(intersection.geometry)
              }
            } else if (intersection.geometry.type === "MultiPolygon") {
              for (const coords of intersection.geometry.coordinates) {
                const p: GeoJSON.Polygon = { type: "Polygon", coordinates: coords }
                const area = turf.area(turf.feature(p))
                if (area > 100) {
                  results.push(p)
                }
              }
            }
          }
        } catch {
          // Skip failed intersection
        }
      }

      return results
    } catch {
      return []
    }
  }, [])

  // Cut all zones with a line
  const cutAllZonesWithLine = useCallback((lineCoords: [number, number][]) => {
    if (lineCoords.length < 2) return

    setZones((prevZones) => {
      const newZones: Zone[] = []
      let counter = 0

      for (const zone of prevZones) {
        const splitResults = splitPolygonWithLine(zone.geometry, lineCoords)

        if (splitResults.length >= 2) {
          // Zone was split
          splitResults.forEach((geom, i) => {
            counter++
            newZones.push({
              ...zone,
              id: `zone-${Date.now()}-${counter}`,
              name: `${zone.name} ${String.fromCharCode(65 + i)}`,
              geometry: geom,
            })
          })
        } else {
          // Zone was not split, keep original
          newZones.push(zone)
        }
      }

      return newZones
    })
  }, [splitPolygonWithLine])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = L.map(mapRef.current, {
      center: [39.8283, -98.5795],
      zoom: 4,
      zoomControl: false,
    })

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    L.control.zoom({ position: "bottomright" }).addTo(map)

    const drawnItems = new L.FeatureGroup()
    map.addLayer(drawnItems)
    drawnItemsRef.current = drawnItems

    const drawControl = new L.Control.Draw({
      position: "topright",
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: ZONE_COLORS[0], fillOpacity: 0.3 },
        },
        rectangle: {
          shapeOptions: { color: ZONE_COLORS[0], fillOpacity: 0.3 },
        },
        polyline: {
          shapeOptions: { color: "#ff0000", weight: 3, dashArray: "10, 10" },
        },
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
    })
    map.addControl(drawControl)

    // Handle created shapes
    map.on(L.Draw.Event.CREATED, (e) => {
      const event = e as L.DrawEvents.Created
      const layer = event.layer
      const layerType = event.layerType

      if (layerType === "polyline") {
        // Cut line - split all intersecting zones
        const polyline = layer as L.Polyline
        const latLngs = polyline.getLatLngs() as L.LatLng[]
        if (latLngs.length >= 2) {
          const lineCoords: [number, number][] = latLngs.map((ll) => [ll.lng, ll.lat])
          cutAllZonesWithLine(lineCoords)
        }
        return // Don't add line to map
      }

      // Polygon or rectangle
      const polygon = layer as L.Polygon
      const geoJson = polygon.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>

      setZones((prev) => {
        const colorIndex = prev.length % ZONE_COLORS.length
        return [...prev, {
          id: `zone-${Date.now()}`,
          name: `Zone ${prev.length + 1}`,
          color: ZONE_COLORS[colorIndex],
          geometry: geoJson.geometry,
          properties: {},
        }]
      })
    })

    // Handle edited shapes
    map.on(L.Draw.Event.EDITED, (e) => {
      const event = e as L.DrawEvents.Edited
      const layers = event.layers
      const updates: { id: string; geometry: GeoJSON.Polygon }[] = []

      layers.eachLayer((layer) => {
        const zoneId = (layer as L.Layer & { zoneId?: string }).zoneId
        if (zoneId && layer instanceof L.Polygon) {
          const geoJson = layer.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>
          updates.push({ id: zoneId, geometry: geoJson.geometry })
        }
      })

      if (updates.length > 0) {
        setZones((prev) =>
          prev.map((z) => {
            const update = updates.find((u) => u.id === z.id)
            return update ? { ...z, geometry: update.geometry } : z
          })
        )
      }
    })

    // Handle deleted shapes
    map.on(L.Draw.Event.DELETED, (e) => {
      const event = e as L.DrawEvents.Deleted
      const deletedIds: string[] = []
      event.layers.eachLayer((layer) => {
        const zoneId = (layer as L.Layer & { zoneId?: string }).zoneId
        if (zoneId) deletedIds.push(zoneId)
      })
      if (deletedIds.length > 0) {
        setZones((prev) => prev.filter((z) => !deletedIds.includes(z.id)))
      }
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [cutAllZonesWithLine])

  // Sync zones to map
  useEffect(() => {
    if (!drawnItemsRef.current) return

    drawnItemsRef.current.clearLayers()

    zones.forEach((zone) => {
      try {
        const coords = zone.geometry.type === "Polygon"
          ? zone.geometry.coordinates[0].map((c) => [c[1], c[0]] as L.LatLngTuple)
          : zone.geometry.coordinates[0][0].map((c) => [c[1], c[0]] as L.LatLngTuple)

        const polygon = L.polygon(coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: selectedZoneId === zone.id ? 0.5 : 0.3,
          weight: selectedZoneId === zone.id ? 3 : 2,
        })

        // Attach zoneId for edit/delete
        ;(polygon as L.Polygon & { zoneId: string }).zoneId = zone.id

        polygon.on("click", () => setSelectedZoneId(zone.id))
        drawnItemsRef.current?.addLayer(polygon)
      } catch {
        // Skip invalid geometry
      }
    })
  }, [zones, selectedZoneId])

  // Generate drive-time rings (non-overlapping donuts)
  const generateDriveTimeRings = useCallback((latlng: L.LatLng) => {
    const center: [number, number] = [latlng.lng, latlng.lat]
    const sortedMinutes = [...driveTimeMinutes].sort((a, b) => a - b)
    const colorSet = RING_COLORS[Math.floor(Math.random() * RING_COLORS.length)]
    const kmPerMinute = 1.2

    const newZones: Zone[] = []
    let previousCircle: turf.Feature<turf.Polygon> | null = null

    sortedMinutes.forEach((minutes, index) => {
      const radiusKm = minutes * kmPerMinute
      const circle = turf.circle(center, radiusKm, { units: "kilometers", steps: 64 })

      let ringGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon

      if (previousCircle) {
        try {
          const donut = turf.difference(turf.featureCollection([circle, previousCircle]))
          ringGeometry = donut ? donut.geometry as GeoJSON.Polygon : circle.geometry
        } catch {
          ringGeometry = circle.geometry
        }
      } else {
        ringGeometry = circle.geometry
      }

      const prevMinutes = index === 0 ? 0 : sortedMinutes[index - 1]
      newZones.push({
        id: `zone-${Date.now()}-${index}`,
        name: `${prevMinutes}-${minutes} min`,
        color: colorSet[Math.min(index, colorSet.length - 1)],
        geometry: ringGeometry,
        properties: { driveTimeRange: `${prevMinutes}-${minutes}` },
      })

      previousCircle = circle
    })

    setZones((prev) => [...prev, ...newZones])
    setIsPlacingMarker(false)

    // Fit bounds to new rings
    if (mapInstanceRef.current && newZones.length > 0) {
      const lastRing = newZones[newZones.length - 1]
      const bbox = turf.bbox(turf.feature(lastRing.geometry))
      mapInstanceRef.current.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]])
    }
  }, [driveTimeMinutes])

  // Handle marker placement for drive-time
  useEffect(() => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (isPlacingMarker) generateDriveTimeRings(e.latlng)
    }

    if (isPlacingMarker) {
      map.getContainer().style.cursor = "crosshair"
      map.on("click", handleClick)
    } else {
      map.getContainer().style.cursor = ""
    }

    return () => {
      map.off("click", handleClick)
      map.getContainer().style.cursor = ""
    }
  }, [isPlacingMarker, generateDriveTimeRings])

  const handleExportGeoJSON = () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: zones.map((z) => ({
        type: "Feature",
        id: z.id,
        properties: { name: z.name, color: z.color, ...z.properties },
        geometry: z.geometry,
      })),
    }
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "zones.geojson"
    a.click()
  }

  const handleImportGeoJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const geoJson = JSON.parse(event.target?.result as string) as GeoJSON.FeatureCollection
        const imported: Zone[] = geoJson.features
          .filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
          .map((f, i) => ({
            id: `zone-${Date.now()}-${i}`,
            name: (f.properties?.name as string) || `Imported ${i + 1}`,
            color: (f.properties?.color as string) || ZONE_COLORS[i % ZONE_COLORS.length],
            geometry: f.geometry as GeoJSON.Polygon,
            properties: f.properties || {},
          }))

        setZones((prev) => [...prev, ...imported])

        if (imported.length > 0 && mapInstanceRef.current) {
          const bbox = turf.bbox(turf.featureCollection(imported.map((z) => turf.feature(z.geometry))))
          mapInstanceRef.current.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]])
        }
      } catch {
        alert("Failed to parse GeoJSON")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const handleCopyGeoJSON = () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: zones.map((z) => ({
        type: "Feature",
        id: z.id,
        properties: { name: z.name, color: z.color, ...z.properties },
        geometry: z.geometry,
      })),
    }
    navigator.clipboard.writeText(JSON.stringify(fc, null, 2))
  }

  const handleSimplifyAll = () => {
    setZones((prev) =>
      prev.map((zone) => {
        try {
          const simplified = turf.simplify(turf.feature(zone.geometry), {
            tolerance: simplifyTolerance,
            highQuality: true,
          })
          return { ...zone, geometry: simplified.geometry as GeoJSON.Polygon }
        } catch {
          return zone
        }
      })
    )
  }

  const handleZoomToZone = (zone: Zone) => {
    if (!mapInstanceRef.current) return
    const bbox = turf.bbox(turf.feature(zone.geometry))
    mapInstanceRef.current.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]])
    setSelectedZoneId(zone.id)
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[hsl(222,47%,11%)]">
      {/* Sidebar */}
      <div className={cn(
        "flex flex-col border-r border-[hsl(217,33%,25%)] bg-[hsl(222,47%,14%)] transition-all duration-300",
        sidebarOpen ? "w-80" : "w-0 overflow-hidden"
      )}>
        <div className="flex items-center gap-2 border-b border-[hsl(217,33%,25%)] p-4">
          <Map className="h-5 w-5 text-[hsl(217,91%,60%)]" />
          <h1 className="text-lg font-semibold text-white">GeoJSON Zones</h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 border-b border-[hsl(217,33%,25%)] p-4">
          <div className="rounded-lg bg-[hsl(217,33%,20%)] p-2 text-center">
            <p className="text-xs text-[hsl(215,20%,65%)]">Zones</p>
            <p className="text-lg font-bold text-white">{stats.totalZones}</p>
          </div>
          <div className="rounded-lg bg-[hsl(217,33%,20%)] p-2 text-center">
            <p className="text-xs text-[hsl(215,20%,65%)]">Area (km²)</p>
            <p className="text-lg font-bold text-white">{stats.totalArea.toFixed(1)}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 border-b border-[hsl(217,33%,25%)] p-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md bg-[hsl(217,33%,25%)] px-3 py-2 text-sm font-medium text-white hover:bg-[hsl(217,33%,30%)]"
          >
            <Upload className="h-4 w-4" />
            Import
          </button>
          <input ref={fileInputRef} type="file" accept=".geojson,.json" onChange={handleImportGeoJSON} className="hidden" />
          <button
            onClick={handleExportGeoJSON}
            disabled={zones.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-[hsl(217,91%,60%)] px-3 py-2 text-sm font-medium text-white hover:bg-[hsl(217,91%,50%)] disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            onClick={handleCopyGeoJSON}
            disabled={zones.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-[hsl(217,33%,25%)] px-3 py-2 text-sm font-medium text-white hover:bg-[hsl(217,33%,30%)] disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => { if (confirm("Delete all zones?")) setZones([]) }}
            disabled={zones.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-[hsl(0,84%,60%)] px-3 py-2 text-sm font-medium text-white hover:bg-[hsl(0,84%,50%)] disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Drive Time section */}
        <div className="border-b border-[hsl(217,33%,25%)]">
          <button
            onClick={() => setShowDriveTime(!showDriveTime)}
            className="flex w-full items-center justify-between p-4 text-sm font-medium text-white hover:bg-[hsl(217,33%,20%)]"
          >
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Drive Time Rings
            </span>
            {showDriveTime ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showDriveTime && (
            <div className="space-y-3 px-4 pb-4">
              <p className="text-xs text-[hsl(215,20%,65%)]">
                Creates non-overlapping donut rings (0-5, 5-10, 10-15 min)
              </p>
              <div className="space-y-2">
                {driveTimeMinutes.map((value, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => {
                        const newValues = [...driveTimeMinutes]
                        newValues[index] = Math.max(1, parseInt(e.target.value) || 1)
                        setDriveTimeMinutes(newValues)
                      }}
                      className="w-16 rounded border border-[hsl(217,33%,25%)] bg-[hsl(222,47%,11%)] px-2 py-1 text-sm text-white"
                      min="1"
                    />
                    <span className="text-sm text-[hsl(215,20%,65%)]">min</span>
                    {driveTimeMinutes.length > 1 && (
                      <button
                        onClick={() => setDriveTimeMinutes(driveTimeMinutes.filter((_, i) => i !== index))}
                        className="ml-auto rounded p-1 text-[hsl(215,20%,65%)] hover:bg-[hsl(217,33%,20%)] hover:text-white"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setDriveTimeMinutes([...driveTimeMinutes, Math.max(...driveTimeMinutes) + 5])}
                className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-[hsl(217,33%,25%)] py-1.5 text-sm text-[hsl(215,20%,65%)] hover:border-[hsl(217,91%,60%)] hover:text-[hsl(217,91%,60%)]"
              >
                + Add Ring
              </button>
              <button
                onClick={() => setIsPlacingMarker(true)}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white",
                  isPlacingMarker ? "bg-amber-500" : "bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,50%)]"
                )}
              >
                <MapPin className="h-4 w-4" />
                {isPlacingMarker ? "Click on map..." : "Place Center Point"}
              </button>
            </div>
          )}
        </div>

        {/* Settings section */}
        <div className="border-b border-[hsl(217,33%,25%)]">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex w-full items-center justify-between p-4 text-sm font-medium text-white hover:bg-[hsl(217,33%,20%)]"
          >
            <span className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings & Help
            </span>
            {showSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showSettings && (
            <div className="space-y-4 px-4 pb-4">
              <div>
                <label className="mb-2 block text-xs text-[hsl(215,20%,65%)]">
                  Simplify Tolerance: {simplifyTolerance.toFixed(4)}
                </label>
                <input
                  type="range"
                  min="0.0001"
                  max="0.01"
                  step="0.0001"
                  value={simplifyTolerance}
                  onChange={(e) => setSimplifyTolerance(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <button
                onClick={handleSimplifyAll}
                disabled={zones.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(217,33%,25%)] px-3 py-2 text-sm font-medium text-white hover:bg-[hsl(217,33%,30%)] disabled:opacity-50"
              >
                <Scissors className="h-4 w-4" />
                Simplify All Zones
              </button>
              <div className="rounded-lg bg-[hsl(217,33%,20%)] p-3 text-xs text-[hsl(215,20%,65%)]">
                <p className="font-medium text-white mb-1">How to Cut/Split Zones:</p>
                <p>Use the polyline tool (line icon, top right) to draw a cut line across zones. ALL zones the line crosses will be split into pieces.</p>
              </div>
            </div>
          )}
        </div>

        {/* Zone list */}
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[hsl(215,20%,65%)]">
            <Layers className="h-4 w-4" />
            Zones ({zones.length})
          </h2>
          {zones.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[hsl(217,33%,25%)] p-6 text-center">
              <FileJson className="mx-auto mb-2 h-8 w-8 text-[hsl(215,20%,65%)]" />
              <p className="text-sm text-[hsl(215,20%,65%)]">
                Draw polygons on the map or import GeoJSON
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {zones.map((zone) => (
                <div
                  key={zone.id}
                  className={cn(
                    "group rounded-lg border p-3 cursor-pointer",
                    selectedZoneId === zone.id
                      ? "border-[hsl(217,91%,60%)] bg-[hsl(217,91%,60%)]/10"
                      : "border-[hsl(217,33%,25%)] hover:border-[hsl(217,91%,60%)]/50"
                  )}
                  onClick={() => setSelectedZoneId(zone.id)}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded" style={{ backgroundColor: zone.color }} />
                    <input
                      type="text"
                      value={zone.name}
                      onChange={(e) => setZones((prev) => prev.map((z) => z.id === zone.id ? { ...z, name: e.target.value } : z))}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent text-sm font-medium text-white outline-none"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleZoomToZone(zone) }}
                      className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-[hsl(217,33%,20%)] text-[hsl(215,20%,65%)]"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setZones((prev) => prev.filter((z) => z.id !== zone.id)) }}
                      className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-[hsl(0,84%,60%)]/20 text-[hsl(0,84%,60%)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {ZONE_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={(e) => {
                          e.stopPropagation()
                          setZones((prev) => prev.map((z) => z.id === zone.id ? { ...z, color } : z))
                        }}
                        className={cn(
                          "h-5 w-5 rounded hover:scale-110 transition-transform",
                          zone.color === color && "ring-2 ring-white ring-offset-2 ring-offset-[hsl(222,47%,14%)]"
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute top-1/2 z-[1000] -translate-y-1/2 rounded-r-md bg-[hsl(222,47%,14%)] p-2 shadow-lg hover:bg-[hsl(217,33%,20%)]"
        style={{ left: sidebarOpen ? "320px" : "0" }}
      >
        <ChevronDown className={cn("h-4 w-4 text-white", sidebarOpen ? "rotate-90" : "-rotate-90")} />
      </button>

      {/* Map */}
      <div ref={mapRef} className="flex-1" />

      {/* Marker placement indicator */}
      {isPlacingMarker && (
        <div className="absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
          Click on map to place center point
          <button onClick={() => setIsPlacingMarker(false)} className="ml-3 rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
