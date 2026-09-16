import { describe, expect, it } from "vitest";
import { datasetForModel } from "./modelRuns";

describe("datasetForModel", () => {
  it("uses ICON-D2 for seamless over Munich and Paris", () => {
    expect(datasetForModel("icon_seamless", { lat: 48.3538, lon: 11.7861 })).toEqual({
      dataset: "dwd_icon_d2",
      nest: "ICON-D2",
    });
    expect(datasetForModel("icon_seamless", { lat: 48.9694, lon: 2.4414 }).dataset).toBe(
      "dwd_icon_d2",
    );
  });

  it("falls back to ICON-EU outside D2 but inside Europe", () => {
    expect(datasetForModel("icon_seamless", { lat: 60.3172, lon: 24.9633 })).toEqual({
      dataset: "dwd_icon_eu",
      nest: "ICON-EU",
    });
  });

  it("uses ICON global in the US and East Asia", () => {
    expect(datasetForModel("icon_seamless", { lat: 29.6454, lon: -95.2789 }).nest).toBe(
      "ICON global",
    );
    expect(datasetForModel("icon_seamless", { lat: 31.1434, lon: 121.8052 })).toEqual({
      dataset: "dwd_icon",
      nest: "ICON global",
    });
  });

  it("uses UK 2 km only over London, not Paris", () => {
    expect(datasetForModel("ukmo_seamless", { lat: 51.5053, lon: 0.0553 })).toEqual({
      dataset: "ukmo_uk_deterministic_2km",
      nest: "UK 2 km",
    });
    expect(datasetForModel("ukmo_seamless", { lat: 48.9694, lon: 2.4414 }).dataset).toBe(
      "ukmo_global_deterministic_10km",
    );
  });

  it("maps native short-range ids to their own dataset without a nest label", () => {
    expect(datasetForModel("icon_d2", { lat: 48.35, lon: 11.78 })).toEqual({
      dataset: "dwd_icon_d2",
      nest: null,
    });
    expect(datasetForModel("ecmwf_ifs025", { lat: 48.35, lon: 11.78 }).dataset).toBe(
      "ecmwf_ifs025",
    );
  });

  it("uses JMA MSM at Shanghai and GSM at Shenzhen", () => {
    expect(datasetForModel("jma_seamless", { lat: 31.1434, lon: 121.8052 })).toEqual({
      dataset: "jma_msm",
      nest: "JMA MSM",
    });
    expect(datasetForModel("jma_seamless", { lat: 22.6393, lon: 113.8107 })).toEqual({
      dataset: "jma_gsm",
      nest: "JMA GSM",
    });
  });

  it("maps AIFS and CMA to their own datasets", () => {
    expect(datasetForModel("ecmwf_aifs025_single", { lat: 22.64, lon: 113.81 }).dataset).toBe(
      "ecmwf_aifs025_single",
    );
    expect(datasetForModel("cma_grapes_global", { lat: 31.14, lon: 121.81 }).dataset).toBe(
      "cma_grapes_global",
    );
  });
});
