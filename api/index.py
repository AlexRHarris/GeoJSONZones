from fasthtml.common import *
from monsterui.all import *
import json
import httpx
import os

# Initialize FastHTML app with MonsterUI theme
hdrs = Theme.blue.headers()
app, rt = fast_app(hdrs=hdrs)

# Leaflet CSS and JS
leaflet_css = Link(rel="stylesheet", href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css")
leaflet_js = Script(src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js")
leaflet_draw_css = Link(rel="stylesheet", href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css")
leaflet_draw_js = Script(src="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js")
turf_js = Script(src="https://unpkg.com/@turf/turf@6/turf.min.js")

# Custom CSS for the map editor
custom_css = Style("""
    #map { height: 600px; width: 100%; border-radius: 8px; }
    .leaflet-container { background: #1a1a2e; }
    .stats-card { font-variant-numeric: tabular-nums; }
    .zone-item { transition: all 0.2s ease; }
    .zone-item:hover { background: var(--uk-color-muted); }
    .drawing-active { cursor: crosshair !important; }
    .vertex-marker { width: 8px !important; height: 8px !important; margin-left: -4px !important; margin-top: -4px !important; }
    .vertex-marker.selected { background: #ef4444 !important; border-color: #fff !important; }
""")


def map_editor_script():
    """JavaScript for the interactive map editor"""
    return Script("""
    let map, drawnItems, drawControl;
    let polygons = [];
    let deliveryZones = [];
    let tolerance = 0.001;
    let showSimplified = false;
    
    // Initialize map
    function initMap() {
        map = L.map('map').setView([33.4484, -112.074], 10);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap, &copy; CartoDB',
            maxZoom: 19
        }).addTo(map);
        
        drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        
        drawControl = new L.Control.Draw({
            edit: { featureGroup: drawnItems },
            draw: {
                polygon: {
                    allowIntersection: false,
                    shapeOptions: { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.3 }
                },
                polyline: false,
                rectangle: {
                    shapeOptions: { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.3 }
                },
                circle: false,
                circlemarker: false,
                marker: false
            }
        });
        map.addControl(drawControl);
        
        // Handle draw events
        map.on(L.Draw.Event.CREATED, function(e) {
            const layer = e.layer;
            const id = 'polygon_' + Date.now();
            layer.options.polygonId = id;
            drawnItems.addLayer(layer);
            polygons.push({ id, layer });
            updateGeoJSON();
            updateStats();
        });
        
        map.on(L.Draw.Event.EDITED, function(e) {
            updateGeoJSON();
            updateStats();
        });
        
        map.on(L.Draw.Event.DELETED, function(e) {
            e.layers.eachLayer(function(layer) {
                const id = layer.options.polygonId;
                polygons = polygons.filter(p => p.id !== id);
            });
            updateGeoJSON();
            updateStats();
        });
        
        console.log('[v0] Map initialized');
    }
    
    // Update GeoJSON display
    function updateGeoJSON() {
        const geojson = drawnItems.toGeoJSON();
        
        if (showSimplified && geojson.features.length > 0) {
            const simplified = {
                type: 'FeatureCollection',
                features: geojson.features.map(f => turf.simplify(f, { tolerance: tolerance, highQuality: true }))
            };
            document.getElementById('geojson-output').textContent = JSON.stringify(simplified, null, 2);
        } else {
            document.getElementById('geojson-output').textContent = JSON.stringify(geojson, null, 2);
        }
    }
    
    // Calculate and update statistics
    function updateStats() {
        const geojson = drawnItems.toGeoJSON();
        let totalArea = 0;
        let totalPerimeter = 0;
        let count = geojson.features.length;
        
        geojson.features.forEach(feature => {
            if (feature.geometry.type === 'Polygon') {
                totalArea += turf.area(feature);
                totalPerimeter += turf.length(turf.polygonToLine(feature), { units: 'kilometers' });
            }
        });
        
        document.getElementById('stat-count').textContent = count;
        document.getElementById('stat-area').textContent = (totalArea / 1000000).toFixed(2) + ' km²';
        document.getElementById('stat-perimeter').textContent = totalPerimeter.toFixed(2) + ' km';
    }
    
    // Download GeoJSON
    function downloadGeoJSON() {
        const geojson = drawnItems.toGeoJSON();
        let data = geojson;
        
        if (showSimplified && geojson.features.length > 0) {
            data = {
                type: 'FeatureCollection',
                features: geojson.features.map(f => turf.simplify(f, { tolerance: tolerance, highQuality: true }))
            };
        }
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'zones.geojson';
        a.click();
        URL.revokeObjectURL(url);
    }
    
    // Import GeoJSON
    function importGeoJSON(input) {
        const file = input.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const geojson = JSON.parse(e.target.result);
                drawnItems.clearLayers();
                polygons = [];
                
                L.geoJSON(geojson, {
                    style: { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.3 },
                    onEachFeature: function(feature, layer) {
                        const id = 'polygon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        layer.options.polygonId = id;
                        drawnItems.addLayer(layer);
                        polygons.push({ id, layer });
                    }
                });
                
                if (drawnItems.getLayers().length > 0) {
                    map.fitBounds(drawnItems.getBounds(), { padding: [50, 50] });
                }
                
                updateGeoJSON();
                updateStats();
                console.log('[v0] GeoJSON imported successfully');
            } catch (error) {
                console.error('[v0] Error importing GeoJSON:', error);
                alert('Invalid GeoJSON file');
            }
        };
        reader.readAsText(file);
    }
    
    // Clear all polygons
    function clearAll() {
        if (confirm('Clear all polygons?')) {
            drawnItems.clearLayers();
            polygons = [];
            deliveryZones = [];
            updateGeoJSON();
            updateStats();
        }
    }
    
    // Set tolerance for simplification
    function setTolerance(value) {
        tolerance = parseFloat(value);
        document.getElementById('tolerance-value').textContent = value;
        updateGeoJSON();
    }
    
    // Toggle simplified view
    function toggleSimplified(checked) {
        showSimplified = checked;
        updateGeoJSON();
    }
    
    // Go to location
    function goToLocation() {
        const lat = parseFloat(document.getElementById('lat-input').value);
        const lng = parseFloat(document.getElementById('lng-input').value);
        if (!isNaN(lat) && !isNaN(lng)) {
            map.setView([lat, lng], 12);
        }
    }
    
    // Generate isochrone (drive-time zone)
    async function generateIsochrone() {
        const lat = parseFloat(document.getElementById('lat-input').value);
        const lng = parseFloat(document.getElementById('lng-input').value);
        const minutes = parseInt(document.getElementById('drive-time').value) || 15;
        const useCircular = document.getElementById('use-circular').checked;
        
        if (isNaN(lat) || isNaN(lng)) {
            alert('Please enter valid coordinates');
            return;
        }
        
        document.getElementById('generate-btn').disabled = true;
        document.getElementById('generate-btn').textContent = 'Generating...';
        
        try {
            if (useCircular) {
                // Create circular approximation
                const radiusKm = (minutes / 60) * 40; // Assume 40 km/h average speed
                const circle = turf.circle([lng, lat], radiusKm, { units: 'kilometers', steps: 64 });
                
                const layer = L.geoJSON(circle, {
                    style: { color: '#10b981', fillColor: '#10b981', fillOpacity: 0.3 }
                });
                
                const id = 'isochrone_' + Date.now();
                layer.eachLayer(l => {
                    l.options.polygonId = id;
                    drawnItems.addLayer(l);
                    polygons.push({ id, layer: l });
                });
                
                map.fitBounds(layer.getBounds(), { padding: [50, 50] });
            } else {
                // Call API for real isochrone
                const response = await fetch('/api/isochrone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat, lng, minutes })
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail || 'Failed to generate isochrone');
                }
                
                const geojson = await response.json();
                
                const layer = L.geoJSON(geojson, {
                    style: { color: '#10b981', fillColor: '#10b981', fillOpacity: 0.3 }
                });
                
                const id = 'isochrone_' + Date.now();
                layer.eachLayer(l => {
                    l.options.polygonId = id;
                    drawnItems.addLayer(l);
                    polygons.push({ id, layer: l });
                });
                
                map.fitBounds(layer.getBounds(), { padding: [50, 50] });
            }
            
            updateGeoJSON();
            updateStats();
            console.log('[v0] Isochrone generated');
        } catch (error) {
            console.error('[v0] Error generating isochrone:', error);
            alert('Failed to generate isochrone: ' + error.message);
        } finally {
            document.getElementById('generate-btn').disabled = false;
            document.getElementById('generate-btn').textContent = 'Generate Zone';
        }
    }
    
    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', initMap);
    """)


@rt("/")
def get():
    """Main page with map editor"""
    return (
        Title("GeoJSON Zone Editor"),
        leaflet_css,
        leaflet_js,
        leaflet_draw_css,
        leaflet_draw_js,
        turf_js,
        custom_css,
        map_editor_script(),
        Container(
            # Header
            DivFullySpaced(
                H1("GeoJSON Zone Editor", cls="text-2xl font-bold"),
                DivLAligned(
                    Button("Import", onclick="document.getElementById('file-input').click()", cls=ButtonT.secondary),
                    Button("Download", onclick="downloadGeoJSON()", cls=ButtonT.primary),
                    Button("Clear All", onclick="clearAll()", cls=ButtonT.destructive),
                    Input(type="file", id="file-input", accept=".geojson,.json", 
                          onchange="importGeoJSON(this)", cls="hidden"),
                    cls="gap-2"
                ),
                cls="py-4"
            ),
            
            # Main content grid
            Grid(
                # Left panel - Controls
                Div(
                    # Location input card
                    Card(
                        H3("Location", cls="font-semibold mb-3"),
                        Grid(
                            Div(
                                Label("Latitude", fr="lat-input"),
                                Input(type="number", id="lat-input", value="33.4484", step="0.0001", cls="w-full"),
                            ),
                            Div(
                                Label("Longitude", fr="lng-input"),
                                Input(type="number", id="lng-input", value="-112.074", step="0.0001", cls="w-full"),
                            ),
                            cols=2, gap=2
                        ),
                        Button("Go to Location", onclick="goToLocation()", cls=f"{ButtonT.secondary} w-full mt-3"),
                        cls="p-4"
                    ),
                    
                    # Drive-time zone card
                    Card(
                        H3("Drive-Time Zone", cls="font-semibold mb-3"),
                        Div(
                            Label("Minutes", fr="drive-time"),
                            Input(type="number", id="drive-time", value="15", min="5", max="60", step="5", cls="w-full"),
                            cls="mb-3"
                        ),
                        DivLAligned(
                            Input(type="checkbox", id="use-circular", checked=True),
                            Label("Use circular approximation", fr="use-circular", cls="text-sm"),
                            cls="gap-2 mb-3"
                        ),
                        Button("Generate Zone", id="generate-btn", onclick="generateIsochrone()", cls=f"{ButtonT.primary} w-full"),
                        P("Creates a drive-time boundary from the location", cls="text-xs text-muted-foreground mt-2"),
                        cls="p-4"
                    ),
                    
                    # Simplification card
                    Card(
                        H3("Simplification", cls="font-semibold mb-3"),
                        Div(
                            DivFullySpaced(
                                Label("Tolerance"),
                                Span("0.001", id="tolerance-value", cls="text-sm font-mono"),
                            ),
                            Input(type="range", id="tolerance-slider", min="0.0001", max="0.01", step="0.0001", 
                                  value="0.001", oninput="setTolerance(this.value)", cls="w-full"),
                            cls="mb-3"
                        ),
                        DivLAligned(
                            Input(type="checkbox", id="show-simplified", onchange="toggleSimplified(this.checked)"),
                            Label("Show simplified", fr="show-simplified", cls="text-sm"),
                            cls="gap-2"
                        ),
                        cls="p-4"
                    ),
                    
                    # Stats card
                    Card(
                        H3("Statistics", cls="font-semibold mb-3"),
                        Grid(
                            Div(
                                P("Polygons", cls="text-xs text-muted-foreground"),
                                P("0", id="stat-count", cls="text-lg font-bold stats-card"),
                            ),
                            Div(
                                P("Total Area", cls="text-xs text-muted-foreground"),
                                P("0 km²", id="stat-area", cls="text-lg font-bold stats-card"),
                            ),
                            Div(
                                P("Perimeter", cls="text-xs text-muted-foreground"),
                                P("0 km", id="stat-perimeter", cls="text-lg font-bold stats-card"),
                            ),
                            cols=1, gap=2
                        ),
                        cls="p-4"
                    ),
                    cls="space-y-4"
                ),
                
                # Right panel - Map and GeoJSON output
                Div(
                    # Map container
                    Card(
                        Div(id="map"),
                        cls="p-2"
                    ),
                    
                    # GeoJSON output
                    Card(
                        DivFullySpaced(
                            H3("GeoJSON Output", cls="font-semibold"),
                            Button("Copy", onclick="navigator.clipboard.writeText(document.getElementById('geojson-output').textContent)", 
                                   cls=ButtonT.ghost + " text-sm"),
                        ),
                        Pre(
                            Code('{"type": "FeatureCollection", "features": []}', id="geojson-output"),
                            cls="bg-muted p-3 rounded text-xs overflow-auto max-h-48 font-mono"
                        ),
                        cls="p-4 mt-4"
                    ),
                    cls="flex-1"
                ),
                
                cols_sm=1, cols_lg=4, gap=4,
                cls="items-start"
            ),
            cls="py-6"
        ),
    )


@rt("/api/isochrone", methods=["POST"])
async def generate_isochrone(request):
    """Generate isochrone using external API"""
    try:
        data = await request.json()
        lat = data.get("lat")
        lng = data.get("lng")
        minutes = data.get("minutes", 15)
        
        # Check for ORS API key
        api_key = os.environ.get("ORS_API_KEY")
        
        if not api_key:
            # Return circular approximation if no API key
            return JSONResponse({
                "error": "No ORS_API_KEY configured. Using circular approximation.",
                "use_circular": True
            }, status_code=400)
        
        # Call OpenRouteService isochrone API
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openrouteservice.org/v2/isochrones/driving-car",
                headers={
                    "Authorization": api_key,
                    "Content-Type": "application/json"
                },
                json={
                    "locations": [[lng, lat]],
                    "range": [minutes * 60],
                    "range_type": "time"
                },
                timeout=30.0
            )
            
            if response.status_code != 200:
                return JSONResponse({
                    "error": f"API error: {response.text}",
                    "use_circular": True
                }, status_code=response.status_code)
            
            return JSONResponse(response.json())
            
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# Export for Vercel - must be named 'app'
# The 'app' variable is already defined above via fast_app()
