"""Pull CMIP6 ocean temperature by depth (GFDL-ESM4 thetao) -> data/ocean_depth.json.

Reads the public CMIP6 Google Cloud bucket anonymously, one year (one zarr chunk) at a time,
and keeps only the global area-weighted mean temperature at each depth level for each year.
Run offline:  python scripts/fetch_depth.py data
Output: {model, levels (m), level_bounds, years{exp}, temp{exp}: [year][level] in degC}
"""
import json, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np, xarray as xr, gcsfs

OUT = sys.argv[1] if len(sys.argv) > 1 else "data"
TEST = "--test" in sys.argv
fs = gcsfs.GCSFileSystem(token="anon")
RUNS = [  # experiment, zarr store, first year, last year
    ("historical", "cmip6/CMIP6/CMIP/NOAA-GFDL/GFDL-ESM4/historical/r1i1p1f1/Omon/thetao/gr/v20190726", 1950, 2014),
    ("ssp126", "cmip6/CMIP6/ScenarioMIP/NOAA-GFDL/GFDL-ESM4/ssp126/r1i1p1f1/Omon/thetao/gr/v20180701", 2015, 2100),
    ("ssp585", "cmip6/CMIP6/ScenarioMIP/NOAA-GFDL/GFDL-ESM4/ssp585/r1i1p1f1/Omon/thetao/gr/v20180701", 2015, 2100),
]

G = {"model": "GFDL-ESM4 r1i1p1f1", "variable": "thetao (sea water potential temperature)",
     "note": "Global area-weighted mean per depth level, yearly mean of monthly data, 1-degree regridded output (gr).",
     "years": {}, "temp": {}}
for exp, path, y0, y1 in RUNS:
    ds = xr.open_zarr(fs.get_mapper(path), consolidated=True, chunks=None,
                      decode_times=xr.coders.CFDatetimeCoder(use_cftime=True))
    da = ds["thetao"]
    if "levels" not in G:
        G["levels"] = [float(v) for v in ds["lev"].values]
        G["level_bounds"] = [[float(a), float(b)] for a, b in ds["lev_bnds"].values]
        w = np.cos(np.radians(ds["lat"].values))[:, None] * np.ones((1, ds.sizes["lon"]))
    yrs = ds["time"].dt.year.values
    years = list(range(y0, y1 + 1))[: 2 if TEST else None]

    def one(yr):
        idx = np.where(yrs == yr)[0]
        for attempt in range(4):
            try:
                v = da.isel(time=slice(idx[0], idx[-1] + 1)).values.astype("f8").mean(axis=0)  # (lev, lat, lon)
                break
            except Exception as e:
                print("retry", exp, yr, repr(e)[:80], flush=True); time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError(f"failed {exp} {yr}")
        prof = []
        for k in range(v.shape[0]):
            m = ~np.isnan(v[k])
            prof.append(round(float((v[k][m] * w[m]).sum() / w[m].sum()), 4) if m.any() else None)
        return prof

    t0 = time.time()
    with ThreadPoolExecutor(8) as ex:
        profs = list(ex.map(one, years))
    G["years"][exp] = years
    G["temp"][exp] = profs
    print(exp, len(years), "years in", round(time.time() - t0), "s; surface", profs[0][0], "->", profs[-1][0], flush=True)

json.dump(G, open(f"{OUT}/ocean_depth{'_test' if TEST else ''}.json", "w"), separators=(",", ":"))
print("done")
