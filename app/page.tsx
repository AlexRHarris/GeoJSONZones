import dynamic from "next/dynamic"

const MapEditor = dynamic(() => import("@/components/map-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Loading map editor...</p>
      </div>
    </div>
  ),
})

export default function Home() {
  return <MapEditor />
}
