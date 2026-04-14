import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { apiKey, locations, range, range_type } = body

    if (!apiKey) {
      return NextResponse.json({ error: "API key is required" }, { status: 400 })
    }

    // Try with query parameter first (some API keys work this way)
    let response = await fetch(
      `https://api.openrouteservice.org/v2/isochrones/driving-car?api_key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, application/geo+json, */*",
        },
        body: JSON.stringify({
          locations,
          range,
          range_type,
        }),
      }
    )

    // If query param fails with 403, try Authorization header
    if (response.status === 403) {
      console.log("Query param auth failed, trying Authorization header...")
      response = await fetch(
        "https://api.openrouteservice.org/v2/isochrones/driving-car",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json, application/geo+json, */*",
            "Authorization": apiKey,
          },
          body: JSON.stringify({
            locations,
            range,
            range_type,
          }),
        }
      )
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error("OpenRouteService API error:", response.status, errorText)
      return NextResponse.json(
        { error: `API error: ${response.status} - ${errorText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error in isochrone API route:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
