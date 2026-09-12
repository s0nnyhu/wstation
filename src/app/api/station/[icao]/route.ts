import { assembleStation } from "@/lib/assemble";
import { parseBiasGrain, parseSeasonMode } from "@/lib/bias";
import { getStation } from "@/config/stations";
import type { MarketDay } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseDay(value: string | null): MarketDay {
  return value === "tomorrow" ? "tomorrow" : "today";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ icao: string }> },
) {
  const { icao } = await context.params;
  const station = getStation(icao);
  if (!station) {
    return Response.json(
      { error: `Unknown station ${icao}. Use a configured ICAO.` },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const day = parseDay(url.searchParams.get("day"));
  const compareAll =
    url.searchParams.get("compareAll") === "1" ||
    url.searchParams.get("compareAll") === "true";
  const fresh =
    url.searchParams.get("fresh") === "1" ||
    url.searchParams.get("fresh") === "true";

  try {
    const payload = await assembleStation(station.icao, day, compareAll, {
      fresh,
      seasonMode: parseSeasonMode(url.searchParams.get("season")),
      biasGrain: parseBiasGrain(url.searchParams.get("grain")),
    });
    return Response.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to assemble station",
      },
      { status: 502 },
    );
  }
}
