// Currents of Consequence: prototype
const C = { historical: "var(--hist)", ssp126: "var(--low)", ssp585: "var(--high)" };
const CH = { historical: "#8a96a3", ssp126: "#2fc4b2", ssp585: "#ff6b57" };
const NAME = { historical: "History", ssp126: "Low emissions", ssp585: "High emissions" };
const tip = d3.select("#tip");
const showTip = (e, h) => tip.style("opacity", 1).style("left", Math.min(e.clientX + 14, innerWidth - 270) + "px").style("top", e.clientY + 14 + "px").html(h);
const hideTip = () => tip.style("opacity", 0);
const sign = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
function segToggle(sel, attr, fn, multi = false) {
  d3.selectAll(`${sel} button`).on("click", function () {
    if (multi) d3.select(this).classed("on", !d3.select(this).classed("on"));
    else { d3.selectAll(`${sel} button`).classed("on", false); d3.select(this).classed("on", true); }
    fn(multi ? d3.selectAll(`${sel} button.on`).nodes().map(n => n.dataset[attr]) : this.dataset[attr]);
  });
}
const cardWidth = sel => Math.floor(document.querySelector(sel).getBoundingClientRect().width);

/* ================= scroll environment ================= */
(() => {
  const secs = [...document.querySelectorAll("section[data-bg]")];
  const bg = document.getElementById("bg"), clouds = document.getElementById("clouds"), rays = document.getElementById("rays"), bub = document.getElementById("bubbles");
  const dv = document.getElementById("depthVal"), dl = document.querySelector("#depth .dl"), dot = document.getElementById("depthDot"), meter = document.getElementById("depth");
  const altScale = d3.scaleSymlog().domain([3000, -4000]).range([0, 1]).constant(50);
  function update() {
    const mid = scrollY + innerHeight / 2;
    const pts = secs.map(s => ({ y: s.offsetTop + s.offsetHeight / 2, c: s.dataset.bg, a: +s.dataset.alt }));
    let i = pts.findIndex(p => p.y > mid);
    let col, alt;
    if (i <= 0) { const p = pts[i < 0 ? pts.length - 1 : 0]; col = p.c; alt = p.a; }
    else { const a = pts[i - 1], b = pts[i], t = (mid - a.y) / (b.y - a.y); col = d3.interpolateRgb(a.c, b.c)(t); alt = a.a + (b.a - a.a) * t; }
    bg.style.background = `linear-gradient(to bottom, ${d3.color(col).brighter(alt > 0 ? .25 : .15)}, ${col} 60%, ${d3.color(col).darker(alt > 0 ? .1 : .35)})`;
    const sky = Math.max(0, Math.min(1, alt / 600)), sea = Math.max(0, Math.min(1, -alt / 100 + .2));
    clouds.style.opacity = sky; bub.style.opacity = sea * .9; rays.style.opacity = alt <= 0 ? Math.max(0, 1 + alt / 1500) : 0;
    dl.textContent = alt > 5 ? "altitude" : alt < -5 ? "depth" : "sea level";
    dv.textContent = Math.abs(alt) <= 5 ? "0 m" : d3.format(",")(Math.round(Math.abs(alt) / 10) * 10) + " m";
    dot.style.top = altScale(alt) * 172 + "px";
    meter.style.color = alt < -20 ? "#d8ecfa" : "#163a57";
  }
  addEventListener("scroll", update, { passive: true }); addEventListener("resize", update); update();
  // bubbles
  const ctx = bub.getContext("2d"); let W, H, B = [];
  const size = () => { W = bub.width = innerWidth; H = bub.height = innerHeight; B = d3.range(70).map(() => ({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 4, v: .3 + Math.random() * .9, w: Math.random() * 6 })); };
  size(); addEventListener("resize", size);
  (function loop(t) {
    if (+bub.style.opacity > 0.01) {
      ctx.clearRect(0, 0, W, H);
      for (const b of B) {
        b.y -= b.v; if (b.y < -10) { b.y = H + 10; b.x = Math.random() * W; }
        ctx.beginPath(); ctx.arc(b.x + Math.sin(t / 900 + b.w) * 6, b.y, b.r, 0, 7);
        ctx.strokeStyle = "rgba(220,240,255,.55)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    requestAnimationFrame(loop);
  })(0);
})();

/* ================= smooth zoomable map ================= */
// grid = {nlat, nlon, lat0, lon0, step}; field = Float32Array(nlat*nlon), NaN = no data
function SmoothMap(sel, { grid, land, color, theme, onHover }) {
  const wrap = d3.select(sel), width = cardWidth(sel), height = Math.round(width * .49);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const canvas = wrap.append("canvas").attr("width", width * dpr).attr("height", height * dpr).style("width", width + "px").style("height", height + "px");
  const ctx = canvas.node().getContext("2d");
  const base = d3.geoEqualEarth().fitExtent([[2, 2], [width - 2, height - 2]], { type: "Sphere" });
  const off = document.createElement("canvas"); off.width = width; off.height = height; const octx = off.getContext("2d");
  const snap = document.createElement("canvas"); snap.width = width * dpr; snap.height = height * dpr;
  let t = d3.zoomIdentity, lastT = t, field = null, L = null;
  const proj = () => d3.geoEqualEarth().scale(base.scale() * t.k).translate([base.translate()[0] * t.k + t.x, base.translate()[1] * t.k + t.y]);
  const { nlat, nlon, lat0, lon0, step } = grid;
  function buildLut() {
    const p = proj(), n = width * height;
    L = { c: new Int32Array(n * 4).fill(-1), tx: new Float32Array(n), ty: new Float32Array(n) };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const ll = p.invert([x + .5, y + .5]); if (!ll || !isFinite(ll[0])) continue;
      const bk = p(ll); if (!bk || Math.abs(bk[0] - x - .5) > .6 || Math.abs(bk[1] - y - .5) > .6) continue;
      const fx = (ll[0] - lon0) / step, fy = Math.max(0, Math.min(nlat - 1, (ll[1] - lat0) / step));
      const i0 = Math.floor(fx), j0 = Math.floor(fy), k = y * width + x;
      const a = ((i0 % nlon) + nlon) % nlon, b = (a + 1) % nlon, j1 = Math.min(nlat - 1, j0 + 1);
      L.c[k * 4] = j0 * nlon + a; L.c[k * 4 + 1] = j0 * nlon + b; L.c[k * 4 + 2] = j1 * nlon + a; L.c[k * 4 + 3] = j1 * nlon + b;
      L.tx[k] = fx - i0; L.ty[k] = fy - j0;
    }
  }
  let lut = null;
  function setColor(c) { color = c; lut = d3.range(512).map(i => d3.rgb(color.interp(i / 511))); }
  setColor(color);
  const landFill = theme === "dark" ? "#16324a" : "#efe7d4", landStroke = theme === "dark" ? "rgba(200,225,245,.35)" : (color.landAlpha === 0 ? "rgba(20,30,40,.7)" : "rgba(60,50,30,.35)");
  const graticule = d3.geoGraticule10();
  function render() {
    if (!field || !L) return;
    const img = octx.createImageData(width, height), d = img.data, [d0, d1] = color.domain;
    for (let k = 0; k < width * height; k++) {
      const c0 = L.c[k * 4]; if (c0 < 0) continue;
      const tx = L.tx[k], ty = L.ty[k], w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let s = 0, ws = 0;
      for (let q = 0; q < 4; q++) { const v = field[L.c[k * 4 + q]]; if (v === v) { s += v * w[q]; ws += w[q]; } }
      if (ws < .2) continue;
      const v = s / ws, u = Math.max(0, Math.min(511, Math.round((v - d0) / (d1 - d0) * 511))), cc = lut[u], o = k * 4;
      d[o] = cc.r; d[o + 1] = cc.g; d[o + 2] = cc.b; d[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    draw();
  }
  function draw() {
    const p = proj(), path = d3.geoPath(p, ctx);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); path({ type: "Sphere" }); ctx.clip();
    ctx.fillStyle = theme === "dark" ? "#0c2238" : "#d5d9dc"; ctx.fill();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, width, height);
    ctx.beginPath(); path(graticule); ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.07)"; ctx.lineWidth = .6; ctx.stroke();
    if (land) { ctx.beginPath(); path(land); ctx.fillStyle = landFill; ctx.globalAlpha = color.landAlpha ?? 1; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = landStroke; ctx.lineWidth = .6; ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); path({ type: "Sphere" }); ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.25)"; ctx.lineWidth = 1; ctx.stroke();
    if (marker) { const m = p(marker); if (m) { ctx.beginPath(); ctx.arc(m[0], m[1], 5, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.stroke(); } }
    const s = snap.getContext("2d"); s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, snap.width, snap.height); s.drawImage(canvas.node(), 0, 0); lastT = t;
  }
  let marker = null;
  const zoom = d3.zoom().scaleExtent([1, 10]).translateExtent([[0, 0], [width, height]])
    .filter(e => (!e.ctrlKey || e.type === "wheel") && !e.button && (e.type !== "wheel" || e.ctrlKey || e.shiftKey || zoomArmed))
    .on("zoom", e => {
      t = e.transform; const k = t.k / lastT.k, x = t.x - lastT.x * k, y = t.y - lastT.y * k;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width * dpr, height * dpr);
      ctx.setTransform(k, 0, 0, k, x * dpr, y * dpr); ctx.drawImage(snap, 0, 0);
    })
    .on("end", () => { buildLut(); render(); });
  let zoomArmed = false; // wheel zooms only after a click on the map, so page scrolling isn't hijacked
  canvas.on("click.arm", () => { zoomArmed = true; }).on("mouseleave.arm", () => { zoomArmed = false; });
  canvas.call(zoom).on("dblclick.zoom", null).on("dblclick", () => canvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity));
  canvas.on("mousemove", e => {
    const [mx, my] = d3.pointer(e), ll = proj().invert([mx, my]);
    if (!ll || !field) return hideTip();
    const bk = proj()(ll); if (!bk || Math.abs(bk[0] - mx) > 1) return hideTip();
    const i = ((Math.round((ll[0] - lon0) / step) % nlon) + nlon) % nlon, j = Math.max(0, Math.min(nlat - 1, Math.round((ll[1] - lat0) / step)));
    onHover && onHover(e, ll, field[j * nlon + i]);
  }).on("mouseleave", hideTip);
  buildLut();
  return {
    setField(f) { field = f; render(); },
    setColor(c) { setColor(c); render(); },
    width, height
  };
}

function legend(sel, color, label, fmtTick) {
  const el = d3.select(sel).html(""), w = Math.min(420, cardWidth(sel)), h = 42;
  const svg = el.append("svg").attr("width", w).attr("height", h);
  const id = "g" + Math.random().toString(36).slice(2);
  const g = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.01, .05).forEach(s => g.append("stop").attr("offset", s).attr("stop-color", color.interp(s)));
  svg.append("rect").attr("x", 18).attr("y", 16).attr("width", w - 38).attr("height", 10).attr("rx", 5).attr("fill", `url(#${id})`);
  const x = d3.scaleLinear(color.domain, [18, w - 20]);
  svg.append("text").attr("x", 0).attr("y", 11).attr("font-weight", 600).text(label);
  svg.selectAll(".t").data(x.ticks(6)).join("text").attr("x", d => x(d)).attr("y", 38).attr("text-anchor", "middle").text(fmtTick);
}

/* ================= load data ================= */
Promise.all([
  d3.json("data/world_geo.json"), d3.json("data/rain_data.json"),
  d3.json("data/sst_meta.json"), fetch("data/sst.bin").then(r => r.arrayBuffer()), d3.json("data/global.json")
]).then(([geo, rain, meta, sstBuf, G]) => {
  const land = geo.land;
  rainSection(land, rain);
  co2Chart(G); scatterChart(G);
  sstSection(land, meta, new Int16Array(sstBuf));
  seaLevelChart(G);
}).catch(err => { console.error(err); document.querySelector("main").insertAdjacentHTML("afterbegin", `<p style="color:#b00">Data failed to load: ${err}</p>`); });

/* ================= SKY: rainfall ================= */
function rainSection(land, R) {
  const nx = 360 / R.step, ny = 180 / R.step, N = nx * ny;
  const color = { domain: [-40, 40], interp: t => d3.interpolateBrBG(t), landAlpha: 0 };
  let s = "s585", bin = 29;
  const map = SmoothMap("#rainMap", { grid: { nlat: ny, nlon: nx, lat0: -90 + R.step / 2, lon0: -180 + R.step / 2, step: R.step }, land, color, theme: "light",
    onHover: (e, ll, v) => showTip(e, `<b>${ll[1].toFixed(0)}°, ${ll[0].toFixed(0)}°</b><br>${v === v ? sign(v) + "% rain vs 1995–2014" : "very dry: no reliable %"}`) });
  legend("#rainLegend", color, "Rainfall change (%)  ·  brown = drier, green = wetter", d => sign(d, 0) + "%");
  function upd() {
    const f = new Float32Array(N);
    for (let c = 0; c < N; c++) { const ts = R[s].ts[c]; f[c] = ts && ts[bin] != null && R.base[c] >= 0.25 ? ts[bin] : NaN; }
    map.setField(f);
    d3.select("#rainYearLbl").text(`${R.bins[bin]}–${R.bins[bin] + 4}`);
  }
  d3.select("#rainYear").on("input", function () { bin = +this.value; upd(); });
  segToggle("#rainScen", "s", v => { s = v; upd(); });
  upd();
}

/* ================= shared line-chart frame ================= */
function frame(sel, { h = 340, m = { l: 56, r: 24, t: 16, b: 40 } } = {}) {
  const w = cardWidth(sel), svg = d3.select(sel).append("svg").attr("width", w).attr("height", h);
  return { svg, w, h, m };
}
function axes(F, x, y, xl, yl, xfmt = d3.format("d")) {
  const { svg, w, h, m } = F;
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(7).tickFormat(xfmt));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5));
  svg.append("text").attr("x", w - m.r).attr("y", h - 6).attr("text-anchor", "end").attr("font-size", 12).attr("opacity", .7).text(xl);
  svg.append("text").attr("x", m.l).attr("y", 11).attr("font-size", 12).attr("opacity", .7).text(yl);
}
const series = (G, key, exp) => G.years[exp].map((y, i) => ({ y, v: G[key][exp][i] }));
function withJoin(G, key, exp) { const h = series(G, key, "historical"); return [h[h.length - 1], ...series(G, key, exp)]; }

/* ================= LAND: CO2 ================= */
function co2Chart(G) {
  const F = frame("#co2Chart"), { svg, w, h, m } = F;
  const all = ["historical", "ssp126", "ssp585"].flatMap(e => G.co2[e]);
  const x = d3.scaleLinear([1950, 2100], [m.l, w - m.r]), y = d3.scaleLinear([d3.min(all) - 10, d3.max(all) + 20], [h - m.b, m.t]).nice();
  axes(F, x, y, "year", "CO₂ (ppm)");
  svg.append("rect").attr("x", x(2014)).attr("y", m.t).attr("width", x(2100) - x(2014)).attr("height", h - m.b - m.t).attr("fill", "currentColor").attr("opacity", .04);
  svg.append("text").attr("x", x(2016)).attr("y", m.t + 14).attr("font-size", 12).attr("opacity", .6).text("projection →");
  const line = d3.line().x(d => x(d.y)).y(d => y(d.v)).curve(d3.curveMonotoneX);
  for (const e of ["historical", "ssp126", "ssp585"]) {
    const d = e === "historical" ? series(G, "co2", e) : withJoin(G, "co2", e);
    const p = svg.append("path").datum(d).attr("fill", "none").attr("stroke", CH[e]).attr("stroke-width", 3).attr("d", line);
    const L = p.node().getTotalLength(); p.attr("stroke-dasharray", L).attr("stroke-dashoffset", L);
    new IntersectionObserver(([en], ob) => { if (en.isIntersecting) { p.transition().duration(1600).delay(e === "historical" ? 0 : 900).attr("stroke-dashoffset", 0); ob.disconnect(); } }, { threshold: .4 }).observe(svg.node());
    const last = d[d.length - 1];
    svg.append("text").attr("x", x(last.y) - 4).attr("y", y(last.v) - 8).attr("text-anchor", "end").attr("font-size", 12).attr("font-weight", 600).attr("fill", CH[e]).text(`${NAME[e]} · ${Math.round(last.v)} ppm`);
  }
  crosshair(svg, F, x, y, yr => ["historical", "ssp126", "ssp585"].map(e => { const i = G.years[e].indexOf(yr); return i < 0 ? null : [e, G.co2[e][i]]; }).filter(Boolean), v => Math.round(v) + " ppm");
}
function crosshair(svg, { w, h, m }, x, y, get, fmt) {
  const g = svg.append("g").style("display", "none");
  g.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "currentColor").attr("opacity", .35);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", w - m.l - m.r).attr("height", h - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", e => {
      const yr = Math.round(x.invert(d3.pointer(e)[0])), vals = get(yr);
      g.style("display", null).select("line").attr("x1", x(yr)).attr("x2", x(yr));
      g.selectAll("circle").data(vals).join("circle").attr("r", 4.5).attr("cx", x(yr)).attr("cy", d => y(d[1])).attr("fill", d => CH[d[0]]).attr("stroke", "#fff");
      showTip(e, `<b>${yr}</b><br>` + vals.map(d => `<span style="color:${CH[d[0]]}">●</span> ${NAME[d[0]]}: ${fmt(d[1])}`).join("<br>"));
    }).on("mouseleave", () => { g.style("display", "none"); hideTip(); });
}

/* ================= LAND: CO2 vs SST ================= */
function scatterChart(G) {
  const F = frame("#scatChart", { h: 380 }), { svg, w, h, m } = F;
  const pts = ["historical", "ssp126", "ssp585"].flatMap(e => G.years[e].map((yr, i) => ({ e, yr, x: G.co2[e][i], y: G.sst[e][i] })));
  const x = d3.scaleLinear(d3.extent(pts, d => d.x), [m.l, w - m.r]).nice(), y = d3.scaleLinear(d3.extent(pts, d => d.y), [h - m.b, m.t]).nice();
  axes(F, x, y, "CO₂ in the air (ppm)", "Global sea surface temperature (°C)", d3.format("d"));
  const gl = svg.append("g"), gd = svg.append("g");
  const line = d3.line().x(d => x(d.x)).y(d => y(d.y));
  for (const e of ["historical", "ssp126", "ssp585"]) {
    gl.append("path").attr("class", "l-" + e).datum(pts.filter(p => p.e === e)).attr("fill", "none").attr("stroke", CH[e]).attr("stroke-width", 1.2).attr("opacity", .5).attr("d", line);
  }
  const dots = gd.selectAll("circle").data(pts).join("circle").attr("cx", d => x(d.x)).attr("cy", d => y(d.y)).attr("r", 3.6).attr("fill", d => CH[d.e]).attr("stroke", "rgba(255,255,255,.8)").attr("stroke-width", .6);
  for (const d of [pts.find(p => p.e === "historical" && p.yr === 1950), pts.find(p => p.e === "ssp126" && p.yr === 2100), pts.find(p => p.e === "ssp585" && p.yr === 2100)])
    svg.append("text").attr("class", "ann-" + d.e).attr("x", x(d.x) + (d.yr === 1950 ? 8 : -8)).attr("y", y(d.y) - 8).attr("text-anchor", d.yr === 1950 ? "start" : "end").attr("font-size", 12).attr("font-weight", 600).text(`${d.yr}: ${d.y.toFixed(1)} °C`);
  const del = d3.Delaunay.from(pts, d => x(d.x), d => y(d.y));
  let on = new Set(["historical", "ssp126", "ssp585"]);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", w - m.l - m.r).attr("height", h - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", e => {
      const [mx, my] = d3.pointer(e), d = pts[del.find(mx, my)];
      if (!on.has(d.e)) return hideTip();
      dots.attr("r", p => p === d ? 7 : 3.6);
      showTip(e, `<b>${d.yr}</b> · ${NAME[d.e]}<br>CO₂ ${Math.round(d.x)} ppm<br>Sea surface ${d.y.toFixed(2)} °C`);
    }).on("mouseleave", () => { dots.attr("r", 3.6); hideTip(); });
  segToggle("#scatScen", "s", list => {
    on = new Set(list);
    dots.transition().attr("opacity", d => on.has(d.e) ? 1 : 0);
    for (const e of ["historical", "ssp126", "ssp585"]) { svg.selectAll(".l-" + e).transition().attr("opacity", on.has(e) ? .5 : 0); svg.selectAll(".ann-" + e).transition().attr("opacity", on.has(e) ? 1 : 0); }
  }, true);
}

/* ================= SURFACE: SST map + histogram ================= */
function sstSection(land, meta, Q) {
  const { nlat, nlon, years, scenario } = meta, N = nlat * nlon;
  const frameIdx = (yr, s) => { for (let i = 0; i < years.length; i++) if (years[i] === yr && (yr <= 2014 ? scenario[i] === "historical" : scenario[i] === s)) return i; return -1; };
  const get = i => { const f = new Float32Array(N); for (let c = 0; c < N; c++) { const q = Q[i * N + c]; f[c] = q === -32768 ? NaN : q / 100; } return f; };
  // baseline 1950-1979
  const base = new Float32Array(N), cnt = new Uint16Array(N);
  for (let yr = 1950; yr <= 1979; yr++) { const f = get(frameIdx(yr)); for (let c = 0; c < N; c++) if (f[c] === f[c]) { base[c] += f[c]; cnt[c]++; } }
  for (let c = 0; c < N; c++) base[c] = cnt[c] ? base[c] / cnt[c] : NaN;
  const wt = Float32Array.from({ length: N }, (_, c) => Math.cos((meta.lat[Math.floor(c / nlon)]) * Math.PI / 180));
  const ABS = { domain: [-2, 31], interp: t => d3.interpolateRdYlBu(1 - t) };
  const ANOM = { domain: [-5, 5], interp: t => d3.interpolateRdBu(1 - t) };
  let yr = 2000, s = "ssp585", mode = "abs";
  const map = SmoothMap("#sstMap", { grid: { nlat, nlon, lat0: meta.lat[0], lon0: meta.lon[0], step: 2 }, land, color: ABS, theme: "dark",
    onHover: (e, ll, v) => v === v ? showTip(e, `<b>${ll[1].toFixed(0)}°, ${ll[0].toFixed(0)}°</b> · ${yr}<br>${mode === "abs" ? v.toFixed(1) + " °C" : sign(v) + " °C vs 1950–79"}`) : hideTip() });
  const anomOf = f => f.map((v, c) => v - base[c]);
  // histogram
  const H = frame("#histChart", { h: 300 }), hb = d3.range(-1.5, 6.01, .25);
  const hx = d3.scaleLinear([-1.5, 6], [H.m.l, H.w - H.m.r]);
  const hist = f => { const a = new Float64Array(hb.length - 1); let tot = 0; for (let c = 0; c < N; c++) { const v = f[c]; if (v !== v) continue; tot += wt[c]; const k = Math.max(0, Math.min(hb.length - 2, Math.floor((v + 1.5) / .25))); a[k] += wt[c]; } return Array.from(a, (v, k) => ({ x0: hb[k], x1: hb[k + 1], p: v / tot * 100 })); };
  const ref = hist(anomOf(get(frameIdx(1980))));
  const hy = d3.scaleLinear([0, 40], [H.h - H.m.b, H.m.t]);
  axes(H, hx, hy, "warming since 1950–1979 (°C)", "% of ocean area", d => sign(d, 0));
  const bars = H.svg.append("g");
  H.svg.append("path").datum(ref).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3")
    .attr("d", d3.line().curve(d3.curveStepAfter).x(d => hx(d.x0)).y(d => hy(d.p)));
  H.svg.append("text").attr("x", hx(ref.reduce((a, b) => b.p > a.p ? b : a).x0)).attr("y", hy(ref.reduce((a, b) => b.p > a.p ? b : a).p) - 6).attr("font-size", 12).text("1980");
  const meanLine = H.svg.append("g");
  function upd() {
    const i = frameIdx(yr, s), f = get(i), an = anomOf(f);
    map.setField(mode === "abs" ? f : an);
    d3.select("#sstYearLbl").text(yr + (yr > 2014 ? " (projected)" : ""));
    const hd = hist(an);
    bars.selectAll("rect").data(hd).join("rect").attr("x", d => hx(d.x0) + .5).attr("width", d => hx(d.x1) - hx(d.x0) - 1)
      .attr("fill", d => ANOM.interp((d.x0 + .125 + 5) / 10)).attr("y", d => hy(Math.min(40, d.p))).attr("height", d => hy(0) - hy(Math.min(40, d.p)))
      .on("mousemove", (e, d) => showTip(e, `${sign(d.x0, 2)} to ${sign(d.x1, 2)} °C<br><b>${d.p.toFixed(1)}%</b> of ocean area (${yr})`)).on("mouseleave", hideTip);
    let sw = 0, sv = 0; for (let c = 0; c < N; c++) if (an[c] === an[c]) { sw += wt[c]; sv += an[c] * wt[c]; }
    const mu = sv / sw;
    meanLine.selectAll("*").remove();
    meanLine.append("line").attr("x1", hx(mu)).attr("x2", hx(mu)).attr("y1", H.m.t).attr("y2", H.h - H.m.b).attr("stroke", "#ffd166").attr("stroke-width", 2);
    meanLine.append("text").attr("x", hx(mu) + 6).attr("y", H.m.t + 14).attr("fill", "#ffd166").attr("font-weight", 700).attr("font-size", 13).text(`${yr} average: ${sign(mu, 2)} °C`);
  }
  d3.select("#sstYear").on("input", function () { yr = +this.value; upd(); });
  segToggle("#sstScen", "s", v => { s = v; upd(); });
  segToggle("#sstMode", "m", v => { mode = v; map.setColor(v === "abs" ? ABS : ANOM); legend("#sstLegend", v === "abs" ? ABS : ANOM, v === "abs" ? "Sea surface temperature (°C)" : "Change since 1950–1979 (°C)", d => v === "abs" ? d : sign(d, 0)); upd(); });
  legend("#sstLegend", ABS, "Sea surface temperature (°C)", d => d);
  let timer = null;
  d3.select("#play").on("click", function () {
    if (timer) { timer.stop(); timer = null; this.textContent = "Play"; return; }
    if (yr >= 2100) yr = 1950;
    this.textContent = "Pause";
    let last = 0;
    timer = d3.timer(el => { if (el - last < 110) return; last = el; yr++; d3.select("#sstYear").property("value", yr); upd(); if (yr >= 2100) { timer.stop(); timer = null; d3.select("#play").text("Play"); } });
  });
  upd();
}

/* ================= DEEP: sea level ================= */
function seaLevelChart(G) {
  const F = frame("#slChart", { h: 360 }), { svg, w, h, m } = F;
  const models = Object.keys(G.sealevel);
  const agg = e => G.years[e].map((yr, i) => { const v = models.map(k => G.sealevel[k][e]?.[i]).filter(v => v != null); return { y: yr, v: d3.mean(v), lo: d3.min(v), hi: d3.max(v) }; });
  const S = { historical: agg("historical"), ssp126: agg("ssp126"), ssp585: agg("ssp585") };
  const all = Object.values(S).flat();
  const x = d3.scaleLinear([1950, 2100], [m.l, w - m.r]), y = d3.scaleLinear([d3.min(all, d => d.lo), d3.max(all, d => d.hi)], [h - m.b, m.t]).nice();
  axes(F, x, y, "year", "Sea level from ocean warming (cm, vs 1995–2014)");
  const defs = svg.append("defs");
  const gr = defs.append("linearGradient").attr("id", "water").attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
  gr.append("stop").attr("offset", 0).attr("stop-color", "#5fc8ff").attr("stop-opacity", .45); gr.append("stop").attr("offset", 1).attr("stop-color", "#5fc8ff").attr("stop-opacity", 0);
  const hiS = [S.historical[S.historical.length - 1], ...S.ssp585];
  svg.append("path").datum([...S.historical, ...S.ssp585]).attr("fill", "url(#water)").attr("d", d3.area().x(d => x(d.y)).y0(h - m.b).y1(d => y(d.v)).curve(d3.curveMonotoneX));
  for (const e of ["historical", "ssp126", "ssp585"]) {
    const d = e === "historical" ? S[e] : [S.historical[S.historical.length - 1], ...S[e]];
    svg.append("path").datum(d).attr("fill", CH[e]).attr("opacity", .18).attr("d", d3.area().x(d => x(d.y)).y0(d => y(d.lo)).y1(d => y(d.hi)).curve(d3.curveMonotoneX));
    svg.append("path").datum(d).attr("fill", "none").attr("stroke", CH[e]).attr("stroke-width", 3).attr("d", d3.line().x(d => x(d.y)).y(d => y(d.v)).curve(d3.curveMonotoneX));
    const last = d[d.length - 1];
    if (e !== "historical") svg.append("text").attr("x", x(last.y) - 4).attr("y", y(last.v) - 10).attr("text-anchor", "end").attr("font-weight", 700).attr("font-size", 13).attr("fill", CH[e]).text(`${NAME[e]}: ${sign(last.v)} cm by 2100`);
  }
  crosshair(svg, F, x, y, yr => ["historical", "ssp126", "ssp585"].map(e => { const r = S[e].find(d => d.y === yr); return r ? [e, r.v] : null; }).filter(Boolean), v => sign(v) + " cm");
  svg.append("text").attr("x", m.l + 8).attr("y", m.t + 14).attr("font-size", 11).attr("opacity", .6).text(`${models.length} models: ${models.join(", ")}`);
}
