import { handleStationApiRequest } from "@/lib/stationApi";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ icao: string; day: string }> },
) {
  const { icao, day } = await context.params;
  return handleStationApiRequest(request, icao, day);
}
