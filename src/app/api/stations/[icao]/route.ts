import { handleStationApiRequest } from "@/lib/stationApi";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ icao: string }> },
) {
  const { icao } = await context.params;
  return handleStationApiRequest(request, icao);
}
