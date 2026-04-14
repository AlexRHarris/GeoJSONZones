"use client"

import dynamic from "next/dynamic"

// Dynamically import the map component to avoid SSR issues with Leaflet
const MapEditor = dynamic(() => import("@/components/map-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
        <p className="text-muted-foreground">Loading map...</p>
      </div>
    </div>
  ),
})

export default function Home() {
  return (
    <main className="h-screen w-full overflow-hidden">
      <MapEditor />
    </main>
  )
}
