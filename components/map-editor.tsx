"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "leaflet-draw"
import "leaflet-draw/dist/leaflet.draw.css"
import * as turf from "@turf/turf"
import polygonClipping from "polygon-clipping"
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
import { cn } from "@/lib/utils"

interface Zone {
  id: string
  name: string
  color: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  properties: Record<string, unknown>
  groupId?: string
}

interface Stats {
  totalZones: number
  totalArea: number
  totalPerimeter: number
}

const ZONE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
]

const RING_COLORS = [
  ["#1e40af", "#3b82f6", "#93c5fd"],
  ["#065f46", "#10b981", "#6ee7b7"],
  ["#92400e", "#f59e0b", "#fcd34d"],
  ["#991b1b", "#ef4444", "#fca5a5"],
  ["#5b21b6", "#8b5cf6", "#c4b5fd"],
]

export default function MapEditor() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zoneLayerMapRef = useRef<Map<string, L.Layer>>(new Map())

  const [zones, setZones] = useState<Zone[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({ totalZones: 0, totalArea: 0, totalPerimeter: 0 })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.001)
  const [showSettings, setShowSettings] = useState(false)
  const [showDriveTime, setShowDriveTime] = useState(false)
  const [driveTimeMinutes, setDriveTimeMinutes] = useState<number[]>([5, 10, 15])
  const [isPlacingMarker, setIsPlacingMarker] = useState(false)
  const [isCutMode, setIsCutMode] = useState(false)

  useEffect(() => {
    let totalArea = 0
    let totalPerimeter = 0

    zones.forEach((zone) => {
      try {
        const feature = turf.feature(zone.geometry)
        totalArea += turf.area(feature)
        if (zone.geometry.type === "Polygon") {
          const line = turf.polygonToLine(feature as turf.Feature<turf.Polygon>)
          if (line.type === "Feature") {
            totalPerimeter += turf.length(line, { units: "kilometers" })
          }
        }
      } catch {
        // Skip invalid geometries
      }
    })

    setStats({
      totalZones: zones.length,
      totalArea: totalArea / 1_000_000,
      totalPerimeter,
    })
  }, [zones])

  // Split a polygon with a line using polygon-clipping
  const splitPolygonWithLine = useCallback((
    polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    lineCoords: [number, number][]
  ): (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] => {
    if (lineCoords.length < 2) return [polygon]

    // Get polygon bounds to extend the line
    const feature = turf.feature(polygon)
    const bbox = turf.bbox(feature)
    const bboxWidth = bbox[2] - bbox[0]
    const bboxHeight = bbox[3] - bbox[1]
    const extend = Math.max(bboxWidth, bboxHeight) * 2

    // Calculate line direction
    const start = lineCoords[0]
    const end = lineCoords[lineCoords.length - 1]
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const len = Math.sqrt(dx * dx + dy * dy)
    
    if (len === 0) return [polygon]

    const ux = dx / len
    const uy = dy / len

    // Extend line in both directions
    const extendedStart: [number, number] = [start[0] - ux * extend, start[1] - uy * extend]
    const extendedEnd: [number, number] = [end[0] + ux * extend, end[1] + uy * extend]

    // Create a thin rectangle (blade) from the line
    const bladeWidth = 0.00001 // Very thin
    const perpX = -uy * bladeWidth
    const perpY = ux * bladeWidth

    // Build blade polygon coordinates
    const bladeCoords: [number, number][] = [
      [extendedStart[0] + perpX, extendedStart[1] + perpY],
      [extendedEnd[0] + perpX, extendedEnd[1] + perpY],
      [extendedEnd[0] - perpX, extendedEnd[1] - perpY],
      [extendedStart[0] - perpX, extendedStart[1] - perpY],
      [extendedStart[0] + perpX, extendedStart[1] + perpY],
    ]

    // Create two half-plane polygons (one on each side of the line)
    const halfPlaneSize = extend * 2
    
    const halfPlane1Coords: [number, number][] = [
      [extendedStart[0] + perpX, extendedStart[1] + perpY],
      [extendedEnd[0] + perpX, extendedEnd[1] + perpY],
      [extendedEnd[0] + perpX - uy * halfPlaneSize, extendedEnd[1] + perpY + ux * halfPlaneSize],
      [extendedStart[0] + perpX - uy * halfPlaneSize, extendedStart[1] + perpY + ux * halfPlaneSize],
      [extendedStart[0] + perpX, extendedStart[1] + perpY],
    ]

    const halfPlane2Coords: [number, number][] = [
      [extendedStart[0] - perpX, extendedStart[1] - perpY],
      [extendedEnd[0] - perpX, extendedEnd[1] - perpY],
      [extendedEnd[0] - perpX + uy * halfPlaneSize, extendedEnd[1] - perpY - ux * halfPlaneSize],
      [extendedStart[0] - perpX + uy * halfPlaneSize, extendedStart[1] - perpY - ux * halfPlaneSize],
      [extendedStart[0] - perpX, extendedStart[1] - perpY],
    ]

    try {
      // Convert polygon to polygon-clipping format
      let polygonCoords: polygonClipping.Polygon[]
      if (polygon.type === "Polygon") {
        polygonCoords = [polygon.coordinates.map(ring => ring.map(c => [c[0], c[1]] as [number, number]))]
      } else {
        polygonCoords = polygon.coordinates.map(poly => 
          poly.map(ring => ring.map(c => [c[0], c[1]] as [number, number]))
        )
      }

      const results: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = []

      // Intersect with each half-plane
      for (const halfPlane of [halfPlane1Coords, halfPlane2Coords]) {
        for (const poly of polygonCoords) {
          try {
            const intersection = polygonClipping.intersection([poly], [[halfPlane]])
            
            if (intersection && intersection.length > 0) {
              for (const resultPoly of intersection) {
                if (resultPoly.length > 0 && resultPoly[0].length >= 4) {
                  const geom: GeoJSON.Polygon = {
                    type: "Polygon",
                    coordinates: resultPoly,
                  }
                  // Check if it has meaningful area
                  const area = turf.area(turf.feature(geom))
                  if (area > 10) { // More than 10 square meters
                    results.push(geom)
                  }
                }
              }
            }
          } catch {
            // Skip failed intersections
          }
        }
      }

      return results.length > 0 ? results : [polygon]
    } catch {
      return [polygon]
    }
  }, [])

  // Cut all zones with a line
  const cutAllZonesWithLine = useCallback((lineCoords: [number, number][]) => {
    if (lineCoords.length < 2) return

    const line = turf.lineString(lineCoords)

    setZones((prevZones) => {
      const newZones: Zone[] = []
      let counter = 0

      for (const zone of prevZones) {
        try {
          // Check if line intersects this zone
          const polygon = turf.feature(zone.geometry)
          const intersects = turf.booleanIntersects(line, polygon)

          if (!intersects) {
            newZones.push(zone)
            continue
          }

          // Split the polygon
          const splitResults = splitPolygonWithLine(zone.geometry, lineCoords)

          if (splitResults.length <= 1) {
            newZones.push(zone)
            continue
          }

          // Create new zones from split results
          splitResults.forEach((geom, i) => {
            counter++
            newZones.push({
              ...zone,
              id: `zone-${Date.now()}-${counter}`,
              name: `${zone.name} (${String.fromCharCode(65 + i)})`,
              geometry: geom,
            })
          })
        } catch {
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
        polyline: {
          shapeOptions: {
            color: "#ff0000",
            weight: 3,
            dashArray: "10, 10",
          },
        },
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
        edit: true,
      },
    })
    map.addControl(drawControl)

    // Handle created shapes
    map.on(L.Draw.Event.CREATED, (e: L.DrawEvents.Created) => {
      const layer = e.layer
      const layerType = e.layerType

      if (layerType === "polyline") {
        // This is a cut line
        const polyline = layer as L.Polyline
        const latLngs = polyline.getLatLngs() as L.LatLng[]
        
        if (latLngs.length >= 2) {
          const lineCoords: [number, number][] = latLngs.map((ll) => [ll.lng, ll.lat])
          cutAllZonesWithLine(lineCoords)
        }
        // Don't add the line to the map
        return
      }

      // It's a polygon or rectangle
      const polygon = layer as L.Polygon
      const geoJson = polygon.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>
      
      setZones((prev) => {
        const colorIndex = prev.length % ZONE_COLORS.length
        const newZone: Zone = {
          id: `zone-${Date.now()}`,
          name: `Zone ${prev.length + 1}`,
          color: ZONE_COLORS[colorIndex],
          geometry: geoJson.geometry,
          properties: {},
        }
        return [...prev, newZone]
      })
    })

    // Handle edited shapes
    map.on(L.Draw.Event.EDITED, (e: L.DrawEvents.Edited) => {
      const layers = e.layers
      const updates: { id: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }[] = []

      layers.eachLayer((layer) => {
        const layerAny = layer as L.Layer & { zoneId?: string }
        
        // Get zoneId from the layer
        const zoneId = layerAny.zoneId
        
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
    map.on(L.Draw.Event.DELETED, (e: L.DrawEvents.Deleted) => {
      const layers = e.layers
      const deletedIds: string[] = []

      layers.eachLayer((layer) => {
        const layerAny = layer as L.Layer & { zoneId?: string }
        if (layerAny.zoneId) {
          deletedIds.push(layerAny.zoneId)
        }
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

  // Sync zones to map layers
  useEffect(() => {
    if (!drawnItemsRef.current || !mapInstanceRef.current) return

    drawnItemsRef.current.clearLayers()
    zoneLayerMapRef.current.clear()

    zones.forEach((zone) => {
      try {
        const polygon = L.polygon(
          zone.geometry.type === "Polygon"
            ? zone.geometry.coordinates[0].map((c) => [c[1], c[0]] as [number, number])
            : zone.geometry.coordinates[0][0].map((c) => [c[1], c[0]] as [number, number]),
          {
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: selectedZoneId === zone.id ? 0.5 : 0.3,
            weight: selectedZoneId === zone.id ? 3 : 2,
          }
        )

        // Attach zoneId for edit/delete handling
        ;(polygon as L.Polygon & { zoneId?: string }).zoneId = zone.id

        polygon.on("click", () => {
          setSelectedZoneId(zone.id)
        })

        drawnItemsRef.current?.addLayer(polygon)
        zoneLayerMapRef.current.set(zone.id, polygon)
      } catch {
        // Skip invalid geometries
      }
    })
  }, [zones, selectedZoneId])

  // Generate drive-time rings
  const generateDriveTimeRings = useCallback((latlng: L.LatLng) => {
    const center = [latlng.lng, latlng.lat] as [number, number]
    const groupId = `drivetime-${Date.now()}`
    const colorSetIndex = Math.floor(Math.random() * RING_COLORS.length)
    const colorSet = RING_COLORS[colorSetIndex]

    const sortedMinutes = [...driveTimeMinutes].sort((a, b) => a - b)
    const kmPerMinute = 1.2

    const newZones: Zone[] = []
    let previousCircle: turf.Feature<turf.Polygon> | null = null

    sortedMinutes.forEach((minutes, index) => {
      const radiusKm = minutes * kmPerMinute
      const circle = turf.circle(center, radiusKm, { units: "kilometers", steps: 64 })

      let ringGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon

      if (previousCircle) {
        try {
          const donut = turf.difference(
            turf.featureCollection([circle, previousCircle])
          )
          if (donut) {
            ringGeometry = donut.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
          } else {
            ringGeometry = circle.geometry
          }
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
        properties: {
          driveTimeMinutes: minutes,
          driveTimeRange: `${prevMinutes}-${minutes}`,
        },
        groupId,
      })

      previousCircle = circle
    })

    setZones((prev) => [...prev, ...newZones])
    setIsPlacingMarker(false)

    if (mapInstanceRef.current && newZones.length > 0) {
      const lastRing = newZones[newZones.length - 1]
      const bbox = turf.bbox(turf.feature(lastRing.geometry))
      mapInstanceRef.current.fitBounds([
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]],
      ])
    }
  }, [driveTimeMinutes])

  // Handle marker placement
  useEffect(() => {
    if (!mapInstanceRef.current) return

    const map = mapInstanceRef.current

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (isPlacingMarker) {
        generateDriveTimeRings(e.latlng)
      }
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
          .filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
          .map((f, i) => ({
            id: `zone-${Date.now()}-${i}`,
            name: (f.properties?.name as string) || `Imported Zone ${i + 1}`,
            color: (f.properties?.color as string) || ZONE_COLORS[i % ZONE_COLORS.length],
            geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
            properties: f.properties || {},
          }))

        setZones((prev) => [...prev, ...importedZones])

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

  const addDriveTimeValue = () => {
    const maxValue = Math.max(...driveTimeMinutes, 0)
    setDriveTimeMinutes([...driveTimeMinutes, maxValue + 5])
  }

  const removeDriveTimeValue = (index: number) => {
    if (driveTimeMinutes.length > 1) {
      setDriveTimeMinutes(driveTimeMinutes.filter((_, i) => i !== index))
    }
  }

  const updateDriveTimeValue = (index: number, value: number) => {
    const newValues = [...driveTimeMinutes]
    newValues[index] = Math.max(1, value)
    setDriveTimeMinutes(newValues)
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
            <div className="flex items-center gap-2 border-b border-border p-4">
              <Map className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">GeoJSON Zones</h1>
            </div>

            <div className="grid grid-cols-3 gap-2 border-b border-border p-4">
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Zones</p>
                <p className="text-lg font-bold">{stats.totalZones}</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Area</p>
                <p className="text-lg font-bold">{stats.totalArea.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">km2</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Perimeter</p>
                <p className="text-lg font-bold">{stats.totalPerimeter.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">km</p>
              </div>
            </div>

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

            <div className="border-b border-border">
              <button
                onClick={() => setShowDriveTime(!showDriveTime)}
                className="flex w-full items-center justify-between p-4 text-sm font-medium hover:bg-muted/50"
              >
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Drive Time Rings
                </span>
                {showDriveTime ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showDriveTime && (
                <div className="space-y-3 px-4 pb-4">
                  <p className="text-xs text-muted-foreground">
                    Creates non-overlapping donut rings (e.g., 0-5, 5-10, 10-15 min)
                  </p>
                  <div className="space-y-2">
                    {driveTimeMinutes.map((value, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="number"
                          value={value}
                          onChange={(e) => updateDriveTimeValue(index, parseInt(e.target.value) || 1)}
                          className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
                          min="1"
                        />
                        <span className="text-sm text-muted-foreground">min</span>
                        {driveTimeMinutes.length > 1 && (
                          <button
                            onClick={() => removeDriveTimeValue(index)}
                            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addDriveTimeValue}
                    className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-border py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    + Add Ring
                  </button>
                  <button
                    onClick={() => setIsPlacingMarker(true)}
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isPlacingMarker
                        ? "bg-amber-500 text-white"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                  >
                    <MapPin className="h-4 w-4" />
                    {isPlacingMarker ? "Click on map..." : "Place Center Point"}
                  </button>
                </div>
              )}
            </div>

            <div className="border-b border-border">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex w-full items-center justify-between p-4 text-sm font-medium hover:bg-muted/50"
              >
                <span className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </span>
                {showSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                  <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">How to cut zones:</p>
                    <p>Use the polyline tool (top right, the line icon) to draw a cutting line across your zones. When you finish the line, ALL zones it crosses will be split.</p>
                  </div>
                </div>
              )}
            </div>

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
                        <div className="h-4 w-4 rounded" style={{ backgroundColor: zone.color }} />
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

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-0 top-1/2 z-[1000] -translate-y-1/2 rounded-r-md bg-card p-2 shadow-lg transition-all hover:bg-muted"
        style={{ left: sidebarOpen ? "320px" : "0" }}
      >
        {sidebarOpen ? <ChevronDown className="h-4 w-4 rotate-90" /> : <ChevronDown className="h-4 w-4 -rotate-90" />}
      </button>

      <div ref={mapRef} className="flex-1" />

      {isPlacingMarker && (
        <div className="absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
          Click on the map to place the center point for drive-time rings
          <button
            onClick={() => setIsPlacingMarker(false)}
            className="ml-3 rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
