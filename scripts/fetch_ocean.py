"""Pull CMIP6 ocean data (Google Cloud public bucket, anonymous) -> small web files.
Outputs in ../data:
  sst.bin   int16 (degC*100), frames = years [hist 1950-2014, ssp126 2015-2100, ssp585 2015-2100], 2-deg grid 90x180 (lat S->N, lon -180..180); -32768 = land
  sst_meta.json, global.json (global SST, CO2 ppm, sea level per scenario)
"""
import csv, json, sys, numpy as np, xarray as xr, gcsfs
fs = gcsfs.GCSFileSystem(token="anon")
CAT = list(csv.DictReader(open(sys.argv[1])))
OUT = sys.argv[2]
def store(model, exp, table, var, grid=None):
    c = [r for r in CAT if r['source_id'] == model and r['experiment_id'] == exp and r['table_id'] == table
         and r['variable_id'] == var and r['member_id'] == 'r1i1p1f1' and (grid is None or r['grid_label'] == grid)]
    c.sort(key=lambda r: r['zstore'])
    return xr.open_zarr(fs.get_mapper(c[-1]['zstore']), consolidated=True, decode_times=True, use_cftime=True)
def annual(da):
    y = da['time'].dt.year
    return da.groupby(y).mean('time')

# ---- SST map (GFDL-ESM4, 1-degree regular grid) ----
frames, years, scen = [], [], []
for exp, y0, y1 in [('historical', 1950, 2014), ('ssp126', 2015, 2100), ('ssp585', 2015, 2100)]:
    ds = store('GFDL-ESM4', exp, 'Omon', 'tos', 'gr')
    da = ds['tos'].sel(time=slice(f'{y0}', f'{y1}'))
    a = annual(da).load()                       # (year, lat, lon)
    lon = a['lon'].values; lon = np.where(lon > 180, lon - 360, lon); order = np.argsort(lon)
    a = a.isel(lon=order)
    v = a.values                                # 180 x 360 at 1 deg
    v2 = np.nanmean(v.reshape(v.shape[0], 90, 2, 180, 2), axis=(2, 4))  # 2-deg
    for i, yr in enumerate(a['year'].values):
        frames.append(v2[i]); years.append(int(yr)); scen.append(exp)
    print(exp, v2.shape, float(np.nanmin(v2)), float(np.nanmax(v2)), flush=True)
arr = np.stack(frames)
q = np.where(np.isnan(arr), -32768, np.round(arr * 100)).astype('<i2')
q.tofile(f'{OUT}/sst.bin')
lat = np.arange(-89, 90, 2).tolist(); lonc = np.arange(-179, 180, 2).tolist()
json.dump({'model': 'GFDL-ESM4 r1i1p1f1', 'nlat': 90, 'nlon': 180, 'lat': lat, 'lon': lonc, 'years': years, 'scenario': scen}, open(f'{OUT}/sst_meta.json', 'w'))

# global area-weighted mean SST per year (from the 2-deg grid)
w = np.cos(np.radians(np.array(lat)))[:, None] * np.ones((1, 180))
def gmean(f): m = ~np.isnan(f); return float((f[m] * w[m]).sum() / w[m].sum())
G = {'years': {}, 'sst': {}, 'co2': {}, 'sealevel': {}}
for exp in ['historical', 'ssp126', 'ssp585']:
    idx = [i for i, s in enumerate(scen) if s == exp]
    G['years'][exp] = [years[i] for i in idx]; G['sst'][exp] = [round(gmean(arr[i]), 3) for i in idx]

# ---- CO2 (GFDL-ESM4 co2mass, kg -> ppm) ----
for exp, y0, y1 in [('historical', 1950, 2014), ('ssp126', 2015, 2100), ('ssp585', 2015, 2100)]:
    c = annual(store('GFDL-ESM4', exp, 'Amon', 'co2mass')['co2mass'].sel(time=slice(f'{y0}', f'{y1}'))).load()
    ppm = c.values / 5.1352e18 * (28.97 / 44.01) * 1e6
    G['co2'][exp] = [round(float(x), 1) for x in ppm]
    print('co2', exp, G['co2'][exp][0], G['co2'][exp][-1], flush=True)

# ---- Global thermosteric sea level (zostoga), 5 models, relative to 1995-2014 ----
SL_MODELS = ['ACCESS-CM2', 'IPSL-CM6A-LR', 'MIROC6', 'MPI-ESM1-2-LR', 'GFDL-ESM4']
sl = {}
for m in SL_MODELS:
    try:
        h = annual(store(m, 'historical', 'Omon', 'zostoga')['zostoga'].squeeze(drop=True).sel(time=slice('1950', '2014'))).load()
        ref = float(h.sel(year=slice(1995, 2014)).mean())
        sl[m] = {'historical': [round(float(x - ref) * 100, 2) for x in h.values]}   # cm
        for exp in ['ssp126', 'ssp585']:
            f = annual(store(m, exp, 'Omon', 'zostoga')['zostoga'].squeeze(drop=True).sel(time=slice('2015', '2100'))).load()
            sl[m][exp] = [round(float(x - ref) * 100, 2) for x in f.values]
        print('sealevel', m, sl[m]['ssp585'][-1], flush=True)
    except Exception as e:
        print('sealevel skip', m, repr(e)[:120], flush=True)
G['sealevel'] = sl
json.dump(G, open(f'{OUT}/global.json', 'w'))
print('done', arr.shape)
