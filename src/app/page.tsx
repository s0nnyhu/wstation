import { getStation } from "@/config/stations";
import { Dashboard } from "@/components/Dashboard";
import { assembleStation } from "@/lib/assemble";
import { parseBiasGrain, parseSeasonMode } from "@/lib/bias";
import type { MarketDay, RegionFilter } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseRegion(value: string | string[] | undefined): RegionFilter {
  if (value === "europe" || value === "america") return value;
  return "all";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawIcao = typeof params.s === "string" ? params.s : "EHAM";
  const icao = getStation(rawIcao)?.icao ?? "EHAM";
  const day: MarketDay = params.d === "tomorrow" ? "tomorrow" : "today";
  const compareAll = params.all === "1" || params.all === "true";
  const regionFilter = parseRegion(params.r);

  const seasonMode = parseSeasonMode(
    typeof params.season === "string" ? params.season : undefined,
  );
  const biasGrain = parseBiasGrain(
    typeof params.grain === "string" ? params.grain : undefined,
  );

  const data = await assembleStation(icao, day, compareAll, {
    seasonMode,
    biasGrain,
  });

  return <Dashboard data={data} initialRegionFilter={regionFilter} />;
}
