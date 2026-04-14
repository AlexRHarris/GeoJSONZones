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
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Scissors,
  FileJson,
  Copy,
  Settings,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Zone {
  id: string
  name: string
  color: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  properties: Record<string, unknown>
}

interface Stats {
  totalZones: number
  totalArea: number
  totalPerimeter: number
}

const ZONE_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
]

export default function MapEditor() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [zones, setZones] = useState<Zone[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({ totalZones: 0, totalArea: 0, totalPerimeter: 0 })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.001)
  const [showSettings, setShowSettings] = useState(false)

  // Calculate stats whenever zones change
  useEffect(() => {
    let totalArea = 0
    let totalPerimeter = 0

    zones.forEach((zone) => {
      try {
        const feature = turf.feature(zone.geometry)
        totalArea += turf.area(feature)
        const line = turf.polygonToLine(feature as turf.Feature<turf.Polygon>)
        if (line.type === "Feature") {
          totalPerimeter += turf.length(line, { units: "kilometers" })
        }
      } catch {
        // Skip invalid geometries
      }
    })

    setStats({
      totalZones: zones.length,
      totalArea: totalArea / 1_000_000, // Convert to km²
      totalPerimeter,
    })
  }, [zones])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = L.map(mapRef.current, {
      center: [39.8283, -98.5795],
      zoom: 4,
      zoomControl: false,
    })

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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
          shapeOptions: {
            color: ZONE_COLORS[0],
            fillOpacity: 0.3,
          },
        },
        rectangle: {
          shapeOptions: {
            color: ZONE_COLORS[0],
            fillOpacity: 0.3,
          },
        },
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
    })
    map.addControl(drawControl)

    map.on(L.Draw.Event.CREATED, (e: L.DrawEvents.Created) => {
      const layer = e.layer as L.Polygon
      const geoJson = layer.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>
      const colorIndex = zones.length % ZONE_COLORS.length
      const newZone: Zone = {
        id: `zone-${Date.now()}`,
        name: `Zone ${zones.length + 1}`,
        color: ZONE_COLORS[colorIndex],
        geometry: geoJson.geometry,
        properties: {},
      }

      ;(layer as L.Path).setStyle({
        color: newZone.color,
        fillColor: newZone.color,
        fillOpacity: 0.3,
      })
      ;(layer as L.Polygon & { zoneId?: string }).zoneId = newZone.id

      drawnItems.addLayer(layer)
      setZones((prev) => [...prev, newZone])
    })

    map.on(L.Draw.Event.EDITED, (e: L.DrawEvents.Edited) => {
      const layers = e.layers
      layers.eachLayer((layer) => {
        const polygon = layer as L.Polygon & { zoneId?: string }
        const zoneId = polygon.zoneId
        if (zoneId) {
          const geoJson = polygon.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>
          setZones((prev) =>
            prev.map((z) => (z.id === zoneId ? { ...z, geometry: geoJson.geometry } : z))
          )
        }
      })
    })

    map.on(L.Draw.Event.DELETED, (e: L.DrawEvents.Deleted) => {
      const layers = e.layers
      const deletedIds: string[] = []
      layers.eachLayer((layer) => {
        const polygon = layer as L.Polygon & { zoneId?: string }
        if (polygon.zoneId) {
          deletedIds.push(polygon.zoneId)
        }
      })
      setZones((prev) => prev.filter((z) => !deletedIds.includes(z.id)))
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // Sync zones to map layers
  const syncZonesToMap = useCallback(() => {
    if (!drawnItemsRef.current || !mapInstanceRef.current) return

    drawnItemsRef.current.clearLayers()

    zones.forEach((zone) => {
      try {
        const geoJsonLayer = L.geoJSON(
          { type: "Feature", geometry: zone.geometry, properties: zone.properties },
          {
            style: {
              color: zone.color,
              fillColor: zone.color,
              fillOpacity: selectedZoneId === zone.id ? 0.5 : 0.3,
              weight: selectedZoneId === zone.id ? 3 : 2,
            },
            onEachFeature: (_, layer) => {
              ;(layer as L.Polygon & { zoneId?: string }).zoneId = zone.id
              layer.on("click", () => {
                setSelectedZoneId(zone.id)
              })
            },
          }
        )
        drawnItemsRef.current?.addLayer(geoJsonLayer)
      } catch {
        // Skip invalid geometries
      }
    })
  }, [zones, selectedZoneId])

  useEffect(() => {
    syncZonesToMap()
  }, [syncZonesToMap])

  const handleExportGeoJSON = () => {
    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: zones.map((zone) => ({
        type: "Feature",
        id: zone.id,
        properties: {
          name: zone.name,
          color: zone.color,
          ...zone.properties,
        },
        geometry: zone.geometry,
      })),
    }

    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "zones.geojson"
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportGeoJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const geoJson = JSON.parse(event.target?.result as string) as GeoJSON.FeatureCollection
        if (geoJson.type !== "FeatureCollection") {
          alert("Invalid GeoJSON: Must be a FeatureCollection")
          return
        }

        const importedZones: Zone[] = geoJson.features
          .filter(
            (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"
          )
          .map((f, i) => ({
            id: `zone-${Date.now()}-${i}`,
            name: (f.properties?.name as string) || `Imported Zone ${i + 1}`,
            color: (f.properties?.color as string) || ZONE_COLORS[i % ZONE_COLORS.length],
            geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
            properties: f.properties || {},
          }))

        setZones((prev) => [...prev, ...importedZones])

        // Fit map to imported zones
        if (importedZones.length > 0 && mapInstanceRef.current) {
          const allFeatures = turf.featureCollection(
            importedZones.map((z) => turf.feature(z.geometry))
          )
          const bbox = turf.bbox(allFeatures)
          mapInstanceRef.current.fitBounds([
            [bbox[1], bbox[0]],
            [bbox[3], bbox[2]],
          ])
        }
      } catch {
        alert("Failed to parse GeoJSON file")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const handleCopyGeoJSON = () => {
    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: zones.map((zone) => ({
        type: "Feature",
        id: zone.id,
        properties: {
          name: zone.name,
          color: zone.color,
          ...zone.properties,
        },
        geometry: zone.geometry,
      })),
    }

    navigator.clipboard.writeText(JSON.stringify(featureCollection, null, 2))
  }

  const handleSimplifyAll = () => {
    setZones((prev) =>
      prev.map((zone) => {
        try {
          const feature = turf.feature(zone.geometry)
          const simplified = turf.simplify(feature, {
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

  const handleClearAll = () => {
    if (confirm("Are you sure you want to delete all zones?")) {
      setZones([])
      setSelectedZoneId(null)
    }
  }

  const handleDeleteZone = (id: string) => {
    setZones((prev) => prev.filter((z) => z.id !== id))
    if (selectedZoneId === id) {
      setSelectedZoneId(null)
    }
  }

  const handleZoomToZone = (zone: Zone) => {
    if (!mapInstanceRef.current) return
    try {
      const feature = turf.feature(zone.geometry)
      const bbox = turf.bbox(feature)
      mapInstanceRef.current.fitBounds([
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]],
      ])
      setSelectedZoneId(zone.id)
    } catch {
      // Ignore errors
    }
  }

  const handleRenameZone = (id: string, newName: string) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, name: newName } : z)))
  }

  const handleChangeZoneColor = (id: string, newColor: string) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, color: newColor } : z)))
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Sidebar */}
      <div
        className={cn(
          "flex flex-col border-r border-border bg-card transition-all duration-300",
          sidebarOpen ? "w-80" : "w-0"
        )}
      >
        {sidebarOpen && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-border p-4">
              <Map className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">GeoJSON Zones</h1>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 border-b border-border p-4">
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Zones</p>
                <p className="text-lg font-bold">{stats.totalZones}</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Area</p>
                <p className="text-lg font-bold">{stats.totalArea.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">km²</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Perimeter</p>
                <p className="text-lg font-bold">{stats.totalPerimeter.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">km</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 border-b border-border p-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
              >
                <Upload className="h-4 w-4" />
                Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".geojson,.json"
                onChange={handleImportGeoJSON}
                className="hidden"
              />
              <button
                onClick={handleExportGeoJSON}
                disabled={zones.length === 0}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
              <button
                onClick={handleCopyGeoJSON}
                disabled={zones.length === 0}
                className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
                Copy
              </button>
              <button
                onClick={handleClearAll}
                disabled={zones.length === 0}
                className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            </div>

            {/* Settings */}
            <div className="border-b border-border">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex w-full items-center justify-between p-4 text-sm font-medium hover:bg-muted/50"
              >
                <span className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </span>
                {showSettings ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showSettings && (
                <div className="space-y-4 px-4 pb-4">
                  <div>
                    <label className="mb-2 block text-xs text-muted-foreground">
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
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
                  >
                    <Scissors className="h-4 w-4" />
                    Simplify All Zones
                  </button>
                </div>
              )}
            </div>

            {/* Zone List */}
            <div className="flex-1 overflow-y-auto p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Layers className="h-4 w-4" />
                Zones ({zones.length})
              </h2>
              {zones.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center">
                  <FileJson className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Draw polygons on the map or import a GeoJSON file
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {zones.map((zone) => (
                    <div
                      key={zone.id}
                      className={cn(
                        "group rounded-lg border p-3 transition-colors",
                        selectedZoneId === zone.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                      )}
                      onClick={() => setSelectedZoneId(zone.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-4 w-4 rounded"
                          style={{ backgroundColor: zone.color }}
                        />
                        <input
                          type="text"
                          value={zone.name}
                          onChange={(e) => handleRenameZone(zone.id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 bg-transparent text-sm font-medium outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleZoomToZone(zone)
                          }}
                          className="rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                          title="Zoom to zone"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteZone(zone.id)
                          }}
                          className="rounded p-1 opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                          title="Delete zone"
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
                              handleChangeZoneColor(zone.id, color)
                            }}
                            className={cn(
                              "h-5 w-5 rounded transition-transform hover:scale-110",
                              zone.color === color && "ring-2 ring-white ring-offset-2 ring-offset-card"
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
          </>
        )}
      </div>

      {/* Toggle Sidebar Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-0 top-1/2 z-[1000] -translate-y-1/2 rounded-r-md bg-card p-2 shadow-lg transition-all hover:bg-muted"
        style={{ left: sidebarOpen ? "320px" : "0" }}
      >
        {sidebarOpen ? (
          <ChevronDown className="h-4 w-4 rotate-90" />
        ) : (
          <ChevronDown className="h-4 w-4 -rotate-90" />
        )}
      </button>

      {/* Map */}
      <div ref={mapRef} className="flex-1" />
    </div>
  )
}
