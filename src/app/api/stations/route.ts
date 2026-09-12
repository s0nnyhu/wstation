import { listStations } from "@/config/stations";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    listStations().map((s) => ({
      icao: s.icao,
      city: s.city,
      name: s.name,
      region: s.region,
      timezone: s.timezone,
      defaultUnit: s.defaultUnit,
      primary: s.primary,
      primaryModels: s.primaryModels,
    })),
  );
}
