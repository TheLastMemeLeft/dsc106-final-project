// Human Consequence: sticky-graphic scroll story
const SC = ["historical", "ssp126", "ssp585"];
const NAME = { historical: "Historical", ssp126: "Low emissions", ssp585: "High emissions" };
const VAR = { historical: "var(--hist)", ssp126: "var(--low)", ssp585: "var(--high)" };
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const narrow = matchMedia("(max-width: 820px)");
const $ = s => document.querySelector(s);
const sign = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const comma = d3.format(",");
const widthOf = el => Math.max(1, Math.floor(el.getBoundingClientRect().width));
const latLon = ll => `${Math.abs(ll[1]).toFixed(0)}°${ll[1] >= 0 ? "N" : "S"}, ${Math.abs(ll[0]).toFixed(0)}°${ll[0] >= 0 ? "E" : "W"}`;

/* ---------- tooltip ---------- */
const tip = d3.select("#tip");
function showTip(e, html) {
  tip.html(html).style("opacity", 1);
  const r = tip.node().getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style("left", Math.max(8, x) + "px").style("top", Math.max(8, y) + "px");
}
const hideTip = () => tip.style("opacity", 0);

/* ---------- segmented buttons ---------- */
function seg(sel, attr, fn, multi = false) {
  const btns = d3.selectAll(`${sel} button`);
  const sync = () => btns.attr("aria-pressed", function () { return this.classList.contains("on"); });
  btns.on("click", function () {
    if (this.getAttribute("aria-disabled") === "true") return;
    if (multi) {
      const on = this.classList.contains("on");
      if (on && d3.selectAll(`${sel} button.on`).size() <= 1) return; // keep at least one series
      this.classList.toggle("on", !on);
    } else { btns.classed("on", false); this.classList.add("on"); }
    sync();
    fn(multi ? d3.selectAll(`${sel} button.on`).nodes().map(n => n.dataset[attr]) : this.dataset[attr]);
  });
  sync();
}
// Play/Pause for a 1950–2100 year slider; advances by elapsed time, so playback keeps pace even when a frame is slow to draw
function player(btn, getYr, setYr) {
  let timer = null;
  const stop = () => { timer?.stop(); timer = null; btn.textContent = "Play"; btn.setAttribute("aria-pressed", "false"); };
  btn.addEventListener("click", () => {
    if (timer) return stop();
    let shown = getYr();
    const start = shown >= 2100 ? 1950 : shown;
    btn.textContent = "Pause"; btn.setAttribute("aria-pressed", "true");
    timer = d3.timer(ms => {
      const next = Math.min(2100, start + Math.floor(ms / 110));
      if (next === shown) return;
      setYr(shown = next);
      if (next >= 2100) stop();
    });
  });
  return stop;
}
function scenarioLock(sel, locked) {
  d3.selectAll(`${sel} button`).attr("aria-disabled", locked ? "true" : null);
  $(sel + "Note").hidden = !locked;
}

/* ---------- re-render on width change ---------- */
const renderers = [];
// desktop chart heights follow the window height; on touch screens only width counts, so the address bar showing/hiding doesn't redraw
const fine = matchMedia("(pointer: fine)");
const sizeKey = () => fine.matches ? innerWidth + "x" + innerHeight : String(innerWidth);
let lastSize = sizeKey(), rT;
addEventListener("resize", () => {
  clearTimeout(rT);
  rT = setTimeout(() => { if (sizeKey() === lastSize) return; lastSize = sizeKey(); renderers.forEach(f => f()); layout(); }, 180);
});

/* ---------- easing: the page's --ease-out token, solved exactly for d3 transitions ---------- */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-5 || !d) break; t -= e / d; }
    return sy(Math.max(0, Math.min(1, t)));
  };
}
const EASE_OUT = bezier(.16, 1, .3, 1); // = --ease-out in style.css
const UI_MS = 250;

/* ---------- line charts: a year-by-year reveal the reader can follow ---------- */
// Lines are uncovered left to right at a constant pace (linear: every year gets the same time),
// with a playhead showing the year and a dot riding each visible series. Labels arrive at the end.
const REVEAL_MS = 6000;
const LINEAR_PACE = { duration: REVEAL_MS, yearAt: t => 1950 + 150 * t };
// Split pace (CO2 and sea level): history slows as it nears the 2014 split, holds a beat, then the two futures
// pull away with growing speed. Years per second follow the story, not the clock.
const SPLIT_PACE = (() => {
  const A = 3400, HOLD = 350, B = 2900, D = A + HOLD + B;
  return {
    duration: D,
    yearAt: t => {
      const ms = t * D;
      if (ms < A) return 1950 + 64 * d3.easeSinOut(ms / A);
      if (ms < A + HOLD) return 2014;
      return 2014 + 86 * d3.easeQuadIn((ms - A - HOLD) / B);
    }
  };
})();
function revealer(svg, F, x, y, plot, labels, series, isOn, pace = LINEAR_PACE) {
  const { h, m } = F, full = x.range()[1] - m.l + 6;
  const id = "rv" + Math.random().toString(36).slice(2);
  const rect = svg.append("defs").append("clipPath").attr("id", id).append("rect").attr("x", m.l - 2).attr("y", 0).attr("width", full).attr("height", h);
  plot.attr("clip-path", `url(#${id})`);
  const head = svg.append("g").attr("class", "playhead").style("display", "none").style("pointer-events", "none");
  const hl = head.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "currentColor").attr("opacity", .45);
  const yl = head.append("text").attr("class", "lbl halo").attr("y", h - m.b - 8).attr("text-anchor", "middle");
  const dots = head.append("g");
  const bis = d3.bisector(d => d.y).left;
  const at = (d, yr) => {
    if (yr < d[0].y || yr > d[d.length - 1].y) return null;
    const i = Math.min(d.length - 1, Math.max(1, bis(d, yr))), a = d[i - 1], b = d[i];
    return a.v + (b.v - a.v) * (b.y === a.y ? 0 : (yr - a.y) / (b.y - a.y));
  };
  const stop = () => { svg.interrupt("reveal"); head.interrupt(); labels.interrupt(); };
  const hide = () => { stop(); rect.attr("width", 0); labels.attr("opacity", 0); };
  const reveal = () => {
    if (reduced.matches) return;
    hide();
    head.style("display", null).attr("opacity", 1);
    svg.transition("reveal").duration(pace.duration).ease(d3.easeLinear).tween("reveal", () => t => {
      const yr = pace.yearAt(t), px = x(yr);
      rect.attr("width", px - m.l + 2);
      hl.attr("x1", px).attr("x2", px);
      yl.attr("x", Math.min(px, x.range()[1] - 16)).text(Math.floor(yr));
      const pts = series.filter(s => isOn().has(s.e)).map(s => ({ e: s.e, v: at(s.d, yr) })).filter(p => p.v != null);
      dots.selectAll("circle").data(pts, p => p.e).join("circle").attr("r", 4.5).attr("cx", px).attr("cy", p => y(p.v))
        .style("fill", p => VAR[p.e]).style("stroke", "var(--ground)").attr("stroke-width", 1.5);
    }).on("end", () => {
      rect.attr("width", full);
      head.transition().duration(UI_MS).ease(EASE_OUT).attr("opacity", 0).on("end", () => head.style("display", "none"));
      labels.transition().duration(UI_MS + 100).ease(EASE_OUT).attr("opacity", 1);
    }).on("interrupt", () => { rect.attr("width", full); labels.attr("opacity", 1); head.style("display", "none"); });
  };
  return { hide, reveal, stop };
}
// play once, the first time the chart's panel comes into view; if the reader is already there, play now
function armReveal(panelId, get) {
  if (reduced.matches) return;
  const panel = document.querySelector(`.panel[data-panel="${panelId}"]`), chapter = panel.closest(".chapter");
  const r = chapter.getBoundingClientRect();
  if (r.top < innerHeight * .6 && r.bottom > 0 && (narrow.matches || panel.classList.contains("on"))) { get().reveal(); return; }
  get().hide();
  let done = false;
  const fire = () => { if (done) return; done = true; get().reveal(); };
  panel.addEventListener("shown", fire, { once: true });
  new IntersectionObserver(([en], ob) => { if (en.isIntersecting && narrow.matches) { ob.disconnect(); fire(); } }, { threshold: .35 }).observe(panel);
}

/* ---------- ambient motion: clouds in the sky, motes rising off the land, bubbles in the sea ---------- */
// Pure CSS transform/opacity animations (compositor, no rAF), drawn behind the cards and charts,
// paused whenever their chapter is off screen, and not shown at all under reduced motion.
(() => {
  const rnd = (a, b) => a + Math.random() * (b - a);
  // keep most particles on the narration side, so the charts on the stage stay quiet
  const px = () => (narrow.matches || Math.random() < .7 ? rnd(2, narrow.matches ? 98 : 40) : rnd(40, 98)) + "%";
  const kinds = {
    cloud: () => { const d = rnd(110, 190); return { "--w": rnd(300, 640) + "px", "--y": rnd(4, 82) + "%", "--d": d + "s", "--delay": -rnd(0, d) + "s", "--o": rnd(.45, .85).toFixed(2), "--rx": rnd(-10, 80) + "vw" }; },
    mote: () => { const d = rnd(16, 30); return { "--x": px(), "--s": rnd(3, 7) + "px", "--d": d + "s", "--delay": -rnd(0, d) + "s", "--sw": rnd(3, 6) + "s", "--o": rnd(.18, .34).toFixed(2) }; },
    bubble: () => { const d = rnd(10, 22); return { "--x": px(), "--s": rnd(4, 14) + "px", "--d": d + "s", "--delay": -rnd(0, d) + "s", "--sw": rnd(2.5, 4.5) + "s", "--o": rnd(.3, .6).toFixed(2) }; }
  };
  function field(host, kind, n) {
    const wrap = document.createElement("div"), inner = document.createElement("div");
    wrap.className = `fx fx-${kind}`; wrap.setAttribute("aria-hidden", "true"); inner.className = "fx-in";
    const count = narrow.matches ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      el.className = kind;
      for (const [k, v] of Object.entries(kinds[kind]())) el.style.setProperty(k, v);
      if (kind !== "cloud") el.appendChild(document.createElement("i"));
      inner.appendChild(el);
    }
    wrap.appendChild(inner); host.prepend(wrap);
    new IntersectionObserver(([en]) => wrap.classList.toggle("run", en.isIntersecting), { rootMargin: "120px 0px" }).observe(host);
  }
  field($("#sky"), "cloud", 5);
  field($("#land"), "mote", 16);
  field($("#surface"), "bubble", 22);
  field($("#deep"), "bubble", 16);
})();

/* ================= scroll: steps, zones, gauge, sea level ================= */
let layout = () => {};
(() => {
  const html = document.documentElement;
  const altEls = [...document.querySelectorAll("[data-alt]:not(button)")];
  const zoneEls = [...document.querySelectorAll("[data-zone]:not(html):not(.gauge)")];
  const surface = $("#surface");
  const gauge = $("#gauge");
  // a second gauge in ocean colours, shown below the waterline while the water passes the gauge
  const under = gauge.cloneNode(true);
  under.id = "gaugeUnder"; under.dataset.zone = "surface"; under.hidden = true;
  under.setAttribute("aria-hidden", "true"); under.removeAttribute("aria-label");
  under.querySelectorAll("button").forEach(b => { b.tabIndex = -1; });
  gauge.after(under);
  const gauges = [gauge, under];
  const zoneBtns = [...gauge.querySelectorAll("button")];
  const alt01 = d3.scaleSymlog().domain([3000, -4000]).range([0, 1]).constant(40);
  let pts = [], trackH = 300;
  const absTop = el => el.getBoundingClientRect().top + scrollY;

  layout = () => {
    pts = altEls.map(el => ({ y: absTop(el) + el.offsetHeight / 2, a: +el.dataset.alt }));
    trackH = gauge.querySelector(".g-track").offsetHeight || 300;
    gauges.forEach(g => g.querySelectorAll(".g-track button").forEach(b => { b.style.top = alt01(+b.dataset.alt) * trackH + "px"; }));
    update();
  };

  // step → active panel
  const activate = step => {
    const chapter = step.closest(".chapter"), id = step.dataset.panel;
    chapter.querySelectorAll(".panel").forEach(p => {
      const on = p.dataset.panel === id;
      p.classList.toggle("on", on);
      if (on) p.dispatchEvent(new Event("shown"));
    });
  };
  const stepObs = new IntersectionObserver(ens => ens.forEach(en => { if (en.isIntersecting) activate(en.target); }), { rootMargin: "-45% 0px -45% 0px" });
  document.querySelectorAll(".step").forEach(s => stepObs.observe(s));

  function update() {
    const mid = scrollY + innerHeight / 2;
    let alt;
    const i = pts.findIndex(p => p.y > mid);
    if (i === 0) alt = pts[0].a;
    else if (i < 0) alt = pts[pts.length - 1].a;
    else { const a = pts[i - 1], b = pts[i]; alt = a.a + (b.a - a.a) * Math.max(0, Math.min(1, (mid - a.y) / (b.y - a.y))); }
    // The crossing is one gesture led by the waterline: the wave rides the top of the ocean chapter
    // (native scroll, so it never lags), and the gauge reading and colour follow that same line.
    const st = surface.getBoundingClientRect().top, wt = st - 18; // 18px: middle of the wave crest
    const gr = gauge.getBoundingClientRect(), gm = gr.top + gr.height / 2;
    const near = wt < innerHeight + 40 && wt > -innerHeight;
    if (near) alt = wt > gm ? Math.max(0, Math.min(alt, 60 * (wt - gm) / Math.max(1, innerHeight - gm))) : Math.min(alt, 0);
    const near0 = Math.abs(alt) < 5;
    const label = near0 ? "Sea level" : alt > 0 ? "Altitude" : "Depth";
    const val = near0 ? "0 m" : comma(Math.round(Math.abs(alt) / 10) * 10) + " m";
    // zone under the middle of the viewport
    let zone = "sky";
    for (const el of zoneEls) { const b = el.getBoundingClientRect(); if (b.top <= innerHeight / 2 && b.bottom > innerHeight / 2) { zone = el.dataset.zone; break; } }
    if (html.dataset.zone !== zone) html.dataset.zone = zone;
    const chapterOf = { sky: "sky", land: "land", surface: "surface", deep: "deep", abyss: "deep" };
    gauges.forEach(g => {
      g.querySelector(".g-label").textContent = label;
      g.querySelector(".g-val").textContent = val;
      g.querySelector(".g-dot").style.top = alt01(alt) * trackH + "px";
      g.querySelectorAll(".g-track button").forEach(b => b.setAttribute("aria-current", String(b.dataset.target === chapterOf[zone])));
    });
    // While the waterline is between the gauge's top and the bottom of the screen, the gauge above it keeps
    // land colours (whatever the page zone says) and an ocean-coloured copy shows below it.
    if (near && wt > gr.top) {
      gauge.dataset.zone = "land";
      if (wt < gr.bottom) {
        under.hidden = false;
        gauge.style.clipPath = `inset(0 0 ${gr.bottom - wt}px 0)`;
        under.style.clipPath = `inset(${wt - gr.top}px 0 0 0)`;
      } else { under.hidden = true; gauge.style.clipPath = ""; }
    } else { delete gauge.dataset.zone; under.hidden = true; gauge.style.clipPath = ""; }
  }
  let ticking = false;
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }, { passive: true });
  zoneBtns.forEach(b => b.addEventListener("click", () => $("#" + b.dataset.target).scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth" })));
  addEventListener("load", layout);
  document.fonts?.ready.then(layout);
  layout();
  new ResizeObserver(() => layout()).observe(document.querySelector("main"));
})();

/* ================= smooth zoomable map ================= */
// grid = {nlat, nlon, lat0, lon0, step}; field = Float32Array(nlat*nlon), NaN = no data
function SmoothMap(el, { grid, land, color, theme, onHover, maxH }) {
  el.innerHTML = "";
  const cw = widthOf(el);
  const width = Math.max(1, Math.min(cw, maxH ? Math.floor(maxH / .49) : cw)), height = Math.max(1, Math.round(width * .49));
  const dpr = Math.min(2, devicePixelRatio || 1);
  const canvas = d3.select(el).append("canvas").attr("width", width * dpr).attr("height", height * dpr).style("width", width + "px").style("height", height + "px")
    .attr("role", "img").attr("tabindex", 0);
  const ctx = canvas.node().getContext("2d");
  const base = d3.geoEqualEarth().fitExtent([[2, 2], [width - 2, height - 2]], { type: "Sphere" });
  const off = document.createElement("canvas"); off.width = width; off.height = height; const octx = off.getContext("2d");
  const snap = document.createElement("canvas"); snap.width = width * dpr; snap.height = height * dpr;
  let t = d3.zoomIdentity, lastT = t, field = null, L = null, lut = null;
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
  function setColor(c) { color = c; lut = d3.range(512).map(i => d3.rgb(color.interp(i / 511))); }
  setColor(color);
  const dark = theme === "dark";
  const landFill = dark ? "#123049" : "#efe7d4", landStroke = dark ? "rgba(200,225,245,.4)" : (color.landAlpha === 0 ? "rgba(20,30,40,.7)" : "rgba(60,50,30,.35)");
  const graticule = d3.geoGraticule10();
  const img = octx.createImageData(width, height);
  function render() {
    if (!field || !L) return;
    const d = img.data, [d0, d1] = color.domain, n = width * height;
    d.fill(0);
    for (let k = 0; k < n; k++) {
      const c0 = L.c[k * 4]; if (c0 < 0) continue;
      const tx = L.tx[k], ty = L.ty[k];
      const w0 = (1 - tx) * (1 - ty), w1 = tx * (1 - ty), w2 = (1 - tx) * ty, w3 = tx * ty;
      let s = 0, ws = 0, v;
      v = field[c0]; if (v === v) { s += v * w0; ws += w0; }
      v = field[L.c[k * 4 + 1]]; if (v === v) { s += v * w1; ws += w1; }
      v = field[L.c[k * 4 + 2]]; if (v === v) { s += v * w2; ws += w2; }
      v = field[L.c[k * 4 + 3]]; if (v === v) { s += v * w3; ws += w3; }
      if (ws < .2) continue;
      const u = Math.max(0, Math.min(511, Math.round(((s / ws) - d0) / (d1 - d0) * 511))), cc = lut[u], o = k * 4;
      d[o] = cc.r; d[o + 1] = cc.g; d[o + 2] = cc.b; d[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    draw();
  }
  function draw() {
    const p = proj(), path = d3.geoPath(p, ctx);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); path({ type: "Sphere" }); ctx.clip();
    ctx.fillStyle = dark ? "#0a2238" : "#d5d9dc"; ctx.fill();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, width, height);
    ctx.beginPath(); path(graticule); ctx.strokeStyle = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.07)"; ctx.lineWidth = .6; ctx.stroke();
    if (land) { ctx.beginPath(); path(land); ctx.fillStyle = landFill; ctx.globalAlpha = color.landAlpha ?? 1; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = landStroke; ctx.lineWidth = .6; ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); path({ type: "Sphere" }); ctx.strokeStyle = dark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.28)"; ctx.lineWidth = 1; ctx.stroke();
    const s = snap.getContext("2d"); s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, snap.width, snap.height); s.drawImage(canvas.node(), 0, 0); lastT = t;
  }
  const zoom = d3.zoom().scaleExtent([1, 10]).translateExtent([[0, 0], [width, height]])
    .filter(e => (!e.ctrlKey || e.type === "wheel") && !e.button && (e.type !== "wheel" || e.ctrlKey || e.shiftKey || zoomArmed))
    .on("zoom", e => {
      t = e.transform; const k = t.k / lastT.k, x = t.x - lastT.x * k, y = t.y - lastT.y * k;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width * dpr, height * dpr);
      ctx.setTransform(k, 0, 0, k, x * dpr, y * dpr); ctx.drawImage(snap, 0, 0);
    })
    .on("end", () => { if (t !== lastT) { buildLut(); render(); } }); // a plain click also sends start/end; nothing moved
  let zoomArmed = false; // the wheel zooms only after a click on the map, so page scrolling is never trapped
  canvas.on("click.arm", () => { zoomArmed = true; }).on("mouseleave.arm", () => { zoomArmed = false; });
  canvas.call(zoom).on("dblclick.zoom", null).on("dblclick", () => canvas.transition().duration(reduced.matches ? 0 : 500).call(zoom.transform, d3.zoomIdentity));
  canvas.on("keydown", e => {
    const k = { "+": 1.5, "=": 1.5, "-": 1 / 1.5 }[e.key];
    if (k) { e.preventDefault(); canvas.call(zoom.scaleBy, k); }
    if (e.key === "0") canvas.call(zoom.transform, d3.zoomIdentity);
  });
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
    label(s) { canvas.attr("aria-label", s); },
    zoomBy(k) { canvas.transition().duration(reduced.matches ? 0 : 300).call(zoom.scaleBy, k); },
    reset() { canvas.transition().duration(reduced.matches ? 0 : 400).call(zoom.transform, d3.zoomIdentity); },
    width, height
  };
}
function mapTools(id, getMap) {
  d3.selectAll(`.maptools[data-for="${id}"] button`).on("click", function () {
    const m = getMap(); if (!m) return;
    const z = this.dataset.z; z === "in" ? m.zoomBy(1.6) : z === "out" ? m.zoomBy(1 / 1.6) : m.reset();
  });
}
const mapMaxH = extra => narrow.matches ? null : Math.max(220, innerHeight - 290 - (extra || 0));

function legend(sel, color, label, fmtTick, maxW) {
  const el = d3.select(sel).html(""), w = Math.max(160, Math.min(440, maxW || widthOf(el.node()))), h = 46;
  const svg = el.append("svg").attr("width", w).attr("height", h).attr("role", "img").attr("aria-label", label);
  const id = "g" + Math.random().toString(36).slice(2);
  const g = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.01, .05).forEach(s => g.append("stop").attr("offset", s).attr("stop-color", color.interp(s)));
  svg.append("rect").attr("x", 18).attr("y", 18).attr("width", w - 36).attr("height", 10).attr("rx", 2).attr("fill", `url(#${id})`);
  const x = d3.scaleLinear(color.domain, [18, w - 18]);
  svg.append("text").attr("x", 0).attr("y", 12).attr("font-weight", 600).text(label);
  svg.selectAll(".t").data(x.ticks(Math.max(3, Math.floor(w / 70)))).join("text").attr("x", d => x(d)).attr("y", 43).attr("text-anchor", "middle").text(fmtTick);
}

/* ================= chart frame ================= */
function frame(el, { h = 380, ml = 56, narrowRatio = .78 } = {}) {
  el.innerHTML = "";
  const w = Math.max(240, widthOf(el)), wide = w >= 560; // a hidden pane can report ~0; the resize pass redraws at the real width
  const H = narrow.matches ? Math.min(h, Math.round(w * narrowRatio)) : Math.min(h, Math.max(260, innerHeight - 260));
  const m = { l: ml, r: wide ? 148 : 16, t: 22, b: 40 };
  const svg = d3.select(el).append("svg").attr("width", w).attr("height", H).attr("role", "img");
  return { svg, w, h: H, m, wide };
}
function axes(F, x, y, xl, yl, xfmt = d3.format("d"), yfmt = null) {
  const { svg, w, h, m } = F;
  const xt = Math.max(3, Math.floor((w - m.l - m.r) / 90));
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(x.range()[1] - m.l)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(xt).tickFormat(xfmt));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(yfmt));
  svg.append("text").attr("class", "muted").attr("x", x.range()[1]).attr("y", h - 6).attr("text-anchor", "end").text(xl);
  svg.append("text").attr("class", "muted").attr("x", m.l).attr("y", 10).text(yl);
}
// end-of-line labels in the right margin, nudged apart so they never overlap
function endLabels(svg, F, x, items) {
  const { wide, m, h } = F;
  const placed = items.slice().sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i++) if (placed[i].y - placed[i - 1].y < 34) placed[i].y = placed[i - 1].y + 34;
  for (const d of placed) {
    const gx = wide ? x.range()[1] + 10 : x.range()[1] - 4, anchor = wide ? "start" : "end", dy = wide ? 0 : -20;
    const t = svg.append("text").attr("class", "halo end-" + d.key).attr("x", gx).attr("y", Math.min(h - m.b, d.y + dy)).attr("text-anchor", anchor).style("fill", d.color);
    t.append("tspan").attr("class", "lbl").attr("x", gx).text(d.name);
    t.append("tspan").attr("class", "sub").attr("x", gx).attr("dy", 16).text(d.value);
  }
}
// bracket naming the gap between the two futures (vertical in the margin, or horizontal at the top)
function gapBracket(svg, F, x, y0, y1, text) {
  const g = svg.append("g").attr("class", "gap");
  if (!F.wide) return g;
  const gx = x.range()[1] + 3;
  g.append("path").attr("d", `M${gx},${y0} h4 V${y1} h-4`).attr("fill", "none").attr("stroke", "currentColor").attr("opacity", .55);
  g.append("text").attr("class", "muted").attr("x", gx + 10).attr("y", (y0 + y1) / 2 + 4).attr("font-weight", 600).text(text);
  return g;
}
// a label offset from its point with a short leader, haloed so it reads over dots and bars
function annotate(g, px, py, dx, dy, text, { anchor = "start", color = "currentColor", cls = "" } = {}) {
  const a = g.append("g").attr("class", cls);
  a.append("path").attr("class", "leader").attr("d", `M${px},${py} L${px + dx * .8},${py + dy * .8}`).style("stroke", color);
  a.append("text").attr("class", "lbl halo").attr("x", px + dx + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0)).attr("y", py + dy + (dy < 0 ? -2 : 10)).attr("text-anchor", anchor).style("fill", color).text(text);
  return a;
}
// a dashed year marker with a dot on the line and a label: used to tie the CO₂ peak to the sea level chart
function yearMarker(g, { h, m }, x, y, yr, v, text, { color = "currentColor", cls = "", dx = -12, dy = 46, anchor = "end" } = {}) {
  const a = g.append("g").attr("class", "year-marker " + cls);
  a.append("line").attr("x1", x(yr)).attr("x2", x(yr)).attr("y1", m.t + 24).attr("y2", h - m.b)
    .attr("stroke", color).attr("stroke-dasharray", "3 4").attr("opacity", .6);
  a.append("circle").attr("cx", x(yr)).attr("cy", y(v)).attr("r", 4.5).style("fill", color).attr("stroke", "#fff").attr("stroke-width", 1.5);
  const t = annotate(a, x(yr), y(v), dx, dy, text, { anchor, color }).select("text");
  const b = t.node().getBBox(), over = b.x + b.width - (x.range()[1] + m.r - 4); // keep the label inside the svg
  if (over > 0) t.attr("x", +t.attr("x") - over);
  return a;
}
// the year low-emissions CO₂ stops rising
const co2PeakYear = G => { const c = G.co2.ssp126; return G.years.ssp126[c.indexOf(d3.max(c))]; };
function crosshair(svg, { h, m }, x, y, get, fmt) {
  const g = svg.append("g").style("display", "none");
  g.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "currentColor").attr("opacity", .4);
  return svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", x.range()[1] - m.l).attr("height", h - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", e => {
      const yr = Math.max(1950, Math.min(2100, Math.round(x.invert(d3.pointer(e)[0])))), vals = get(yr);
      if (!vals.length) { g.style("display", "none"); return hideTip(); }
      g.style("display", null).select("line").attr("x1", x(yr)).attr("x2", x(yr));
      g.selectAll("circle").data(vals).join("circle").attr("r", 4.5).attr("cx", x(yr)).attr("cy", d => y(d[1])).style("fill", d => VAR[d[0]]).attr("stroke", "#fff").attr("stroke-width", 1.5);
      showTip(e, `<b>${yr}</b>${yr > 2014 ? " · projected" : ""}<br>` + vals.map(d => `${NAME[d[0]]}: ${fmt(d[1])}`).join("<br>"));
    }).on("mouseleave", () => { g.style("display", "none"); hideTip(); });
}
const series = (G, key, exp) => G.years[exp].map((y, i) => ({ y, v: G[key][exp][i] }));
const joined = (G, key, exp) => { const h = series(G, key, "historical"); return [h[h.length - 1], ...series(G, key, exp)]; };
const pairHTML = (what, lo, hi, unit, single) => single != null
  ? `${what}: <b>${single}${unit}</b> <span>(one history before 2015)</span>`
  : `${what}: <b class="lo">Low ${lo}${unit}</b> · <b class="hi">High ${hi}${unit}</b>`;

/* ================= load data, section by section ================= */
function fail(ids, what) {
  return err => {
    console.error(err);
    ids.forEach(id => { const el = $(id); if (el) el.innerHTML = `<p class="status err">Couldn't load ${what}. Reload the page to try again.</p>`; });
  };
}
const fetchJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
const geoP = fetchJSON("data/world_geo.json");
const globalP = fetchJSON("data/global.json");
globalP.then(G => { co2Chart(G); scatterChart(G); seaLevelChart(G); })
  .catch(fail(["#co2Chart", "#scatChart", "#slChart"], "the CO₂, temperature and sea level data"));
Promise.all([geoP, fetchJSON("data/rain_data.json")]).then(([geo, R]) => rainSection(geo.land, R))
  .catch(fail(["#rainMap"], "the rainfall data"));
Promise.all([geoP, fetchJSON("data/sst_meta.json"), fetch("data/sst.bin").then(r => { if (!r.ok) throw new Error("sst.bin: " + r.status); return r.arrayBuffer(); })])
  .then(([geo, meta, buf]) => sstSection(geo.land, meta, new Int16Array(buf)))
  .catch(fail(["#sstMap", "#histChart"], "the ocean temperature data"));
Promise.all([globalP, fetchJSON("data/ocean_depth.json")]).then(([G, D]) => depthChart(D, co2PeakYear(G)))
  .catch(fail(["#depthChart"], "the deep ocean data"));

/* ================= SKY: rainfall ================= */
function rainSection(land, R) {
  const el = $("#rainMap"), nx = 360 / R.step, ny = 180 / R.step, N = nx * ny;
  const color = { domain: [-40, 40], interp: t => d3.interpolateBrBG(t), landAlpha: 0 };
  const wt = Float32Array.from({ length: N }, (_, c) => Math.cos((-90 + R.step / 2 + Math.floor(c / nx) * R.step) * Math.PI / 180));
  let s = "s585", bin = R.bins.length - 1, map = null;
  const period = () => `${R.bins[bin]}–${R.bins[bin] + 4}`;
  const valid = (sc, c) => { const ts = R[sc].ts[c]; return ts && ts[bin] != null && R.base[c] >= 0.25 ? ts[bin] : NaN; };
  const meanOf = sc => { let a = 0, w = 0; for (let c = 0; c < N; c++) { const v = valid(sc, c); if (v === v) { a += v * wt[c]; w += wt[c]; } } return a / w; };
  function build() {
    map = SmoothMap(el, {
      grid: { nlat: ny, nlon: nx, lat0: -90 + R.step / 2, lon0: -180 + R.step / 2, step: R.step }, land, color, theme: "light", maxH: mapMaxH(30),
      onHover: (e, ll, v) => showTip(e, `<b>${latLon(ll)}</b><br>${v === v ? sign(v) + "% rain vs 1995–2014" : "Desert: too dry for a reliable %"}`)
    });
    legend("#rainLegend", color, "Rainfall change (%) · brown is drier, green is wetter", d => sign(d, 0) + "%", map.width);
    upd();
  }
  function upd() {
    const f = new Float32Array(N);
    for (let c = 0; c < N; c++) f[c] = valid(s, c);
    map.setField(f);
    const proj = R.bins[bin] >= 2015;
    $("#rainYearLbl").textContent = period();
    $("#rainProj").hidden = !proj;
    $("#rainYear").setAttribute("aria-valuetext", period() + (proj ? ", projected" : ""));
    scenarioLock("#rainScen", !proj);
    $("#rainPair").innerHTML = proj
      ? pairHTML(`Average change across mapped areas, ${period()}`, sign(meanOf("s126")), sign(meanOf("s585")), "%")
      : pairHTML(`Average change across mapped areas, ${period()}`, 0, 0, "%", sign(meanOf(s)));
    map.label(`Map of rainfall change for ${period()}${proj ? ", " + (s === "s126" ? "low" : "high") + " emissions" : ""}, compared with 1995–2014. Brown areas get drier, green areas get wetter, grey areas are deserts.`);
  }
  d3.select("#rainYear").on("input", function () { bin = +this.value; upd(); });
  seg("#rainScen", "s", v => { s = v; upd(); });
  mapTools("rainMap", () => map);
  build(); renderers.push(build);
}

/* ================= LAND: CO2 ================= */
function co2Chart(G) {
  const el = $("#co2Chart"), lines = {};
  let on = new Set(SC), cur = null;
  const vis = animate => {
    const t = d3.transition().duration(reduced.matches ? 0 : UI_MS).ease(EASE_OUT);
    const fade = (q, show) => { const s = d3.select(el).selectAll(q); (animate ? s.transition(t) : s).attr("opacity", show ? 1 : 0); };
    SC.forEach(e => fade(".l-" + e + ", .end-" + e, on.has(e)));
    fade(".gap", on.has("ssp126") && on.has("ssp585"));
  };
  function build() {
    cur?.stop();
    const F = frame(el, { h: 420 }), { svg, h, m } = F;
    const x = d3.scaleLinear([1950, 2100], [m.l, F.w - m.r]), y = d3.scaleLinear([280, 1150], [h - m.b, m.t]).nice();
    svg.attr("aria-label", "Line chart of CO₂ in the atmosphere, 1950 to 2100. It rises from 313 ppm in 1950 to 391 ppm in 2014, then reaches 447 ppm by 2100 with low emissions or 1,102 ppm with high emissions.");
    svg.append("rect").attr("x", x(2014)).attr("y", m.t).attr("width", x(2100) - x(2014)).attr("height", h - m.b - m.t).attr("fill", "currentColor").attr("opacity", .05);
    axes(F, x, y, "Year", "CO₂ (ppm)");
    svg.append("text").attr("class", "muted").attr("x", x(2014) + 8).attr("y", m.t + 16).text("Projection →");
    const line = d3.line().x(d => x(d.y)).y(d => y(d.v)).curve(d3.curveMonotoneX);
    const plot = svg.append("g"), labels = svg.append("g");
    for (const e of SC) {
      lines[e] = e === "historical" ? series(G, "co2", e) : joined(G, "co2", e);
      plot.append("path").attr("class", "l-" + e).datum(lines[e]).attr("fill", "none").style("stroke", VAR[e]).attr("stroke-width", e === "historical" ? 2.5 : 3).attr("d", line);
    }
    const lo = lines.ssp126.at(-1), hi = lines.ssp585.at(-1), h14 = lines.historical.at(-1);
    endLabels(labels, F, x, [
      { key: "ssp585", name: "High emissions", value: `${comma(Math.round(hi.v))} ppm in 2100`, y: y(hi.v), color: VAR.ssp585 },
      { key: "ssp126", name: "Low emissions", value: `${Math.round(lo.v)} ppm in 2100`, y: y(lo.v), color: VAR.ssp126 }
    ]);
    gapBracket(labels, F, x, y(hi.v) + 26, y(lo.v) - 8, `${comma(Math.round(hi.v - lo.v))} ppm apart`);
    labels.append("text").attr("class", "sub halo end-historical").attr("x", x(2014) - 6).attr("y", y(h14.v) - 12).attr("text-anchor", "end").style("fill", VAR.historical).text(`${Math.round(h14.v)} ppm in 2014`);
    const pk = co2PeakYear(G), pkV = G.co2.ssp126[G.years.ssp126.indexOf(pk)];
    yearMarker(labels, F, x, y, pk, pkV, F.wide ? `Low emissions: CO₂ peaks in ${pk}, then falls` : `Low peaks in ${pk}`, { color: VAR.ssp126, cls: "end-ssp126" });
    crosshair(svg, F, x, y, yr => SC.filter(e => on.has(e)).map(e => { const i = G.years[e].indexOf(yr); return i < 0 ? null : [e, G.co2[e][i]]; }).filter(Boolean), v => Math.round(v) + " ppm");
    vis(false);
    cur = revealer(svg, F, x, y, plot, labels, SC.map(e => ({ e, d: lines[e] })), () => on, SPLIT_PACE);
  }
  seg("#co2Scen", "s", list => { on = new Set(list); vis(true); }, true);
  $("#co2Replay").addEventListener("click", () => cur.reveal());
  build(); renderers.push(build);
  armReveal("co2", () => cur);
}

/* ================= LAND: CO2 vs SST (connected scatter) ================= */
function scatterChart(G) {
  const el = $("#scatChart");
  let on = new Set(SC), reindex = () => {};
  const order = ["historical", "ssp585", "ssp126"]; // low drawn last so it isn't buried under high
  const vis = animate => {
    const t = d3.transition().duration(reduced.matches ? 0 : UI_MS).ease(EASE_OUT);
    for (const e of SC) { const s = d3.select(el).selectAll(`.s-${e}, .ann-${e}`); (animate ? s.transition(t) : s).attr("opacity", on.has(e) ? 1 : 0); }
  };
  function build() {
    const F = frame(el, { h: 420, ml: 52 }), { svg, h, m } = F;
    const pts = order.flatMap(e => G.years[e].map((yr, i) => ({ e, yr, x: G.co2[e][i], y: G.sst[e][i] })));
    const x = d3.scaleLog([300, 1150], [m.l, F.w - m.r]), y = d3.scaleLinear(d3.extent(pts, d => d.y), [h - m.b, m.t]).nice();
    svg.attr("aria-label", "Connected scatter of global sea surface temperature against CO₂, one dot per year. Temperature climbs with CO₂: by 2100 it reaches 18.8 °C with low emissions and 20.7 °C with high emissions.");
    axes(F, x, y, "CO₂ in the air (ppm, log scale)", "Global sea surface temperature (°C)", d3.format(","), d => d.toFixed(1));
    svg.select(".axis").selectAll(".tick").filter(d => ![300, 400, 500, 600, 800, 1000].includes(d)).select("text").remove();
    const line = d3.line().x(d => x(d.x)).y(d => y(d.y));
    const groups = svg.append("g").selectAll("g").data(order).join("g").attr("class", d => "s-" + d);
    groups.append("path").attr("fill", "none").style("stroke", d => VAR[d]).attr("stroke-width", 1.4).attr("opacity", .55).attr("d", d => line(pts.filter(p => p.e === d)));
    groups.selectAll("circle").data(d => pts.filter(p => p.e === d)).join("circle").attr("cx", d => x(d.x)).attr("cy", d => y(d.y)).attr("r", 3.2).style("fill", d => VAR[d.e]).attr("opacity", .85);
    const ann = svg.append("g");
    const at = (e, yr) => pts.find(p => p.e === e && p.yr === yr);
    const p50 = at("historical", 1950), pLo = at("ssp126", 2100), pHi = at("ssp585", 2100);
    // 1950: down and to the right, clear of the historical cloud
    annotate(ann, x(p50.x), y(p50.y), 26, 22, `1950 · ${p50.y.toFixed(1)} °C`, { color: VAR.historical, cls: "ann-historical" });
    // 2100 ends: labels go into the empty space above-left of the rising series, never onto it
    if (F.wide) {
      annotate(ann, x(pLo.x), y(pLo.y), -18, -48, `Low emissions, 2100 · ${pLo.y.toFixed(1)} °C`, { anchor: x(pLo.x) - 220 > m.l ? "end" : "start", color: VAR.ssp126, cls: "ann-ssp126" });
      annotate(ann, x(pHi.x), y(pHi.y), -26, -26, `High emissions, 2100 · ${pHi.y.toFixed(1)} °C`, { anchor: "end", color: VAR.ssp585, cls: "ann-ssp585" });
    } else {
      annotate(ann, x(pLo.x), y(pLo.y), -50, -72, `Low, 2100 · ${pLo.y.toFixed(1)} °C`, { anchor: "start", color: VAR.ssp126, cls: "ann-ssp126" });
      annotate(ann, x(pHi.x), y(pHi.y), -44, 6, `High, 2100 · ${pHi.y.toFixed(1)} °C`, { anchor: "end", color: VAR.ssp585, cls: "ann-ssp585" });
    }
    vis(false);
    // hover finds the nearest visible dot, so a hidden series never steals it
    let shown, del;
    reindex = () => { shown = pts.filter(p => on.has(p.e)); del = d3.Delaunay.from(shown, d => x(d.x), d => y(d.y)); };
    reindex();
    const ring = svg.append("circle").attr("r", 7).attr("fill", "none").attr("stroke", "currentColor").attr("stroke-width", 1.5).style("display", "none");
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", x.range()[1] - m.l).attr("height", h - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", e => {
        const [mx, my] = d3.pointer(e), d = shown[del.find(mx, my)];
        if (!d) { ring.style("display", "none"); return hideTip(); }
        ring.style("display", null).attr("cx", x(d.x)).attr("cy", y(d.y));
        showTip(e, `<b>${d.yr}</b> · ${NAME[d.e]}<br>CO₂ ${comma(Math.round(d.x))} ppm<br>Sea surface ${d.y.toFixed(2)} °C`);
      }).on("mouseleave", () => { ring.style("display", "none"); hideTip(); });
  }
  seg("#scatScen", "s", list => { on = new Set(list); vis(true); reindex(); }, true);
  build(); renderers.push(build);
}

/* ================= OCEAN SURFACE: SST map + histogram, one shared control row ================= */
function sstSection(land, meta, Q) {
  const { nlat, nlon, years, scenario } = meta, N = nlat * nlon;
  const frameIdx = (yr, s) => { for (let i = 0; i < years.length; i++) if (years[i] === yr && (yr <= 2014 ? scenario[i] === "historical" : scenario[i] === s)) return i; return -1; };
  const cache = new Map();
  const get = i => {
    if (cache.has(i)) return cache.get(i);
    const f = new Float32Array(N); for (let c = 0; c < N; c++) { const q = Q[i * N + c]; f[c] = q === -32768 ? NaN : q / 100; }
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    cache.set(i, f); return f;
  };
  const base = new Float32Array(N), cnt = new Uint16Array(N);
  for (let yr = 1950; yr <= 1979; yr++) { const f = get(frameIdx(yr)); for (let c = 0; c < N; c++) if (f[c] === f[c]) { base[c] += f[c]; cnt[c]++; } }
  for (let c = 0; c < N; c++) base[c] = cnt[c] ? base[c] / cnt[c] : NaN;
  const wt = Float32Array.from({ length: N }, (_, c) => Math.cos(meta.lat[Math.floor(c / nlon)] * Math.PI / 180));
  const ABS = { domain: [-2, 31], interp: t => d3.interpolateRdYlBu(1 - t) };
  const ANOM = { domain: [-4, 4], interp: t => d3.interpolateRdBu(1 - t) };
  let yr = 1950, s = "ssp585", mode = "abs", map = null, H = null;
  const other = () => s === "ssp585" ? "ssp126" : "ssp585";
  const anomOf = f => f.map((v, c) => v - base[c]);
  const meanOf = an => { let sw = 0, sv = 0; for (let c = 0; c < N; c++) if (an[c] === an[c]) { sw += wt[c]; sv += an[c] * wt[c]; } return sv / sw; };
  const hb = d3.range(-1.5, 6.01, .25);
  const hist = f => { const a = new Float64Array(hb.length - 1); let tot = 0; for (let c = 0; c < N; c++) { const v = f[c]; if (v !== v) continue; tot += wt[c]; const k = Math.max(0, Math.min(hb.length - 2, Math.floor((v + 1.5) / .25))); a[k] += wt[c]; } return Array.from(a, (v, k) => ({ x0: hb[k], x1: hb[k + 1], p: v / tot * 100 })); };
  const ref = hist(anomOf(get(frameIdx(1980))));
  const scen = e => yr <= 2014 ? "Historical" : NAME[e || s];
  const modeSeg = $("#sstMode");

  function buildMap() {
    map = SmoothMap($("#sstMap"), {
      grid: { nlat, nlon, lat0: meta.lat[0], lon0: meta.lon[0], step: 2 }, land, color: mode === "abs" ? ABS : ANOM, theme: "dark", maxH: mapMaxH(70),
      onHover: (e, ll, v) => v === v ? showTip(e, `<b>${latLon(ll)}</b> · ${yr}${yr > 2014 ? " (projected)" : ""}<br>${mode === "abs" ? v.toFixed(1) + " °C" : sign(v) + " °C vs 1950–1979"}`) : hideTip()
    });
    drawLegend();
  }
  function drawLegend() {
    legend("#sstLegend", mode === "abs" ? ABS : ANOM, mode === "abs" ? "Sea surface temperature (°C)" : "Change since 1950–1979 (°C) · red is warmer", d => mode === "abs" ? d : sign(d, 0), map.width);
  }
  function buildHist() {
    const el = $("#histChart");
    const F = frame(el, { h: 420, ml: 48 }); F.m.r = 20; F.m.t = 66; // headroom for the two means and their bracket
    const x = d3.scaleLinear([-1.5, 6], [F.m.l, F.w - F.m.r]), y = d3.scaleLinear([0, 40], [F.h - F.m.b, F.m.t]);
    axes(F, x, y, "Warming since 1950–1979 (°C)", "% of ocean area", d => sign(d, 0), d => d + "%");
    const bars = F.svg.append("g");
    const otherLine = F.svg.append("path").attr("fill", "none").attr("stroke-width", 2);
    F.svg.append("path").datum(ref).attr("fill", "none").attr("stroke", "currentColor").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3")
      .attr("d", d3.line().curve(d3.curveStepAfter).x(d => x(d.x0)).y(d => y(Math.min(40, d.p))));
    const peak = ref.reduce((a, b) => b.p > a.p ? b : a);
    annotate(F.svg, x(peak.x0), y(peak.p), -18, -16, "1980", { anchor: "end" });
    const means = F.svg.append("g");
    H = { F, x, y, bars, otherLine, means };
  }
  function upd(animate = false) {
    const proj = yr > 2014;
    const an = anomOf(get(frameIdx(yr, s))), mu = meanOf(an);
    const anO = proj ? anomOf(get(frameIdx(yr, other()))) : null, muO = proj ? meanOf(anO) : null;
    map.setField(mode === "abs" ? get(frameIdx(yr, s)) : an);
    $("#sstYearLbl").textContent = yr;
    $("#sstProj").hidden = !proj;
    $("#sstYear").setAttribute("aria-valuetext", yr + (proj ? ", projected" : ""));
    scenarioLock("#sstScen", !proj);
    const lo = s === "ssp126" ? mu : muO, hi = s === "ssp585" ? mu : muO;
    $("#sstPair").innerHTML = proj
      ? pairHTML(`Ocean average warming since 1950–1979, ${yr}`, sign(lo, 2), sign(hi, 2), " °C")
      : pairHTML(`Ocean average warming since 1950–1979, ${yr}`, 0, 0, " °C", sign(mu, 2));
    map.label(`Map of ${mode === "abs" ? "sea surface temperature" : "warming since 1950–1979"} in ${yr}, ${scen()}. Ocean average warming since 1950–1979: ${sign(mu, 2)} °C.`);
    // histogram: the chosen future as bars, the other future as an outline, 1980 dashed
    const { F, x, y, bars, otherLine, means } = H;
    const col = proj ? VAR[s] : VAR.historical;
    F.svg.attr("aria-label", `Histogram of ocean area by warming since 1950–1979, ${yr}. ${proj ? `Low emissions averages ${sign(lo, 2)} °C and high emissions ${sign(hi, 2)} °C.` : `Average ${sign(mu, 2)} °C.`} The dashed outline shows 1980.`);
    // a scenario switch (occasional) eases the bars into place so the swap reads; slider and Play stay instant
    const ease = animate && !reduced.matches, stepLine = d3.line().curve(d3.curveStepAfter).x(d => x(d.x0)).y(d => y(Math.min(40, d.p)));
    const rects = bars.selectAll("rect").data(hist(an)).join("rect").attr("x", d => x(d.x0) + .5).attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 1))
      .on("mousemove", (e, d) => showTip(e, `${sign(d.x0, 2)} to ${sign(d.x1, 2)} °C<br><b>${d.p.toFixed(1)}%</b> of ocean area in ${yr} · ${scen()}`)).on("mouseleave", hideTip);
    rects.interrupt().style("fill", col); otherLine.interrupt();
    (ease ? rects.transition().duration(UI_MS).ease(EASE_OUT) : rects).attr("opacity", .92).attr("y", d => y(Math.min(40, d.p))).attr("height", d => y(0) - y(Math.min(40, d.p)));
    if (proj) { otherLine.datum(hist(anO)).style("stroke", VAR[other()]); (ease ? otherLine.transition().duration(UI_MS).ease(EASE_OUT) : otherLine).attr("opacity", 1).attr("d", stepLine); }
    else otherLine.attr("opacity", 0);
    means.selectAll("*").remove();
    const top = F.m.t - 30;
    const mark = (v, e) => means.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", top + 10).attr("y2", F.h - F.m.b).style("stroke", VAR[e]).attr("stroke-width", 2);
    if (proj) {
      const [a, b] = lo < hi ? [["ssp126", lo], ["ssp585", hi]] : [["ssp585", hi], ["ssp126", lo]];
      mark(a[1], a[0]); mark(b[1], b[0]);
      means.append("path").attr("d", `M${x(a[1])},${top + 6} V${top} H${x(b[1])} V${top + 6}`).attr("fill", "none").attr("stroke", "currentColor").attr("opacity", .6);
      const mid = (x(a[1]) + x(b[1])) / 2;
      means.append("text").attr("class", "lbl halo").attr("x", mid).attr("y", top - 6).attr("text-anchor", "middle").text(`${(b[1] - a[1]).toFixed(1)} °C apart`);
      means.append("text").attr("class", "sub halo").attr("x", x(a[1]) - 6).attr("y", top + 24).attr("text-anchor", "end").style("fill", VAR[a[0]]).text(`${a[0] === "ssp126" ? "Low" : "High"} ${sign(a[1], 2)} °C`);
      means.append("text").attr("class", "sub halo").attr("x", x(b[1]) + 6).attr("y", top + 24).style("fill", VAR[b[0]]).text(`${b[0] === "ssp126" ? "Low" : "High"} ${sign(b[1], 2)} °C`);
    } else {
      mark(mu, "historical");
      means.append("text").attr("class", "sub halo").attr("x", x(mu) + 6).attr("y", top + 24).style("fill", VAR.historical).text(`${yr} average ${sign(mu, 2)} °C`);
    }
  }
  function build() { buildMap(); buildHist(); upd(); }
  const stop = player($("#play"), () => yr, v => { yr = v; $("#sstYear").value = yr; upd(); });
  d3.select("#sstYear").on("input", function () { stop(); yr = +this.value; upd(); });
  seg("#sstScen", "s", v => { s = v; upd(true); });
  seg("#sstMode", "m", v => { mode = v; map.setColor(v === "abs" ? ABS : ANOM); drawLegend(); upd(); });
  mapTools("sstMap", () => map);
  // Temperature/Change only applies to the map, so it steps aside while the histogram is up
  document.querySelector('.panel[data-panel="sst"]').addEventListener("shown", () => { modeSeg.hidden = false; });
  document.querySelector('.panel[data-panel="hist"]').addEventListener("shown", () => { if (!narrow.matches) modeSeg.hidden = true; });
  build(); renderers.push(build);
}

/* ================= DEEP: warming by depth ================= */
const DEPTH_MAX = 2000;
function depthChart(D, peakYr) {
  const el = $("#depthChart");
  // "Over time" view: warming vs 1995-2014 (the sea level chart's baseline) at the surface and averaged over the top 2,000 m
  const wTop = D.level_bounds.map(([a, b]) => Math.max(0, Math.min(b, DEPTH_MAX) - a)), wSum = d3.sum(wTop);
  const ref95 = D.levels.map((_, k) => d3.mean(D.years.historical.map((y, i) => y >= 1995 && y <= 2014 ? D.temp.historical[i][k] : null).filter(v => v != null)));
  const tsOf = e => D.years[e].map((y, i) => { const t = D.temp[e][i]; return { y, surf: t[0] - ref95[0], top: d3.sum(t, (v, k) => (v - ref95[k]) * wTop[k]) / wSum }; });
  const TS = { historical: tsOf("historical") };
  for (const e of ["ssp126", "ssp585"]) TS[e] = [TS.historical.at(-1), ...tsOf(e)];
  const avgOf = (e, key, y0, y1) => d3.mean(TS[e].filter(d => d.y >= y0 && d.y <= y1), d => d[key]);
  let view = "depth";
  const keep = D.levels.map((z, k) => z <= DEPTH_MAX + 100 ? k : -1).filter(k => k >= 0);
  const z = keep.map(k => D.levels[k]);
  // baseline: 1950-1979 mean at each depth
  const hy = D.years.historical, base = keep.map(k => d3.mean(hy.map((y, i) => y <= 1979 ? D.temp.historical[i][k] : null).filter(v => v != null)));
  const prof = (e, yr) => { const i = D.years[e].indexOf(yr); return i < 0 ? null : keep.map((k, j) => ({ z: z[j], v: D.temp[e][i][k] - base[j] })); };
  const at = (p, depth) => { const j = d3.bisector(d => d.z).left(p, depth); const a = p[Math.max(0, j - 1)], b = p[Math.min(p.length - 1, j)]; return a.z === b.z ? a.v : a.v + (b.v - a.v) * (depth - a.z) / (b.z - a.z); };
  const MARK = 1000;
  const all = ["ssp126", "ssp585"].flatMap(e => D.years[e].flatMap(y => prof(e, y))).concat(hy.flatMap(y => prof("historical", y)));
  let yr = 2100, draw = null;
  const series = () => yr <= 2014 ? [["historical", prof("historical", yr)]] : [["ssp126", prof("ssp126", yr)], ["ssp585", prof("ssp585", yr)]];
  const build = () => view === "time" ? buildTime() : buildDepth();
  function buildTime() {
    draw = null;
    const F = frame(el, { h: 460, narrowRatio: 1.25 }), { svg, h, m } = F, gap = 46;
    const x = d3.scaleLinear([1950, 2100], [m.l, F.w - m.r]), mid = (m.t + h - m.b) / 2;
    const panels = [
      { key: "surf", title: "Sea surface", top: m.t + 22, bot: mid - gap / 2 },
      { key: "top", title: `Top ${comma(DEPTH_MAX)} m average: the heat stored`, top: mid + gap / 2 + 4, bot: h - m.b }
    ];
    svg.attr("aria-label", `Two line charts sharing a time axis, 1950 to 2100, warming compared with 1995–2014. Top: sea surface. Bottom: average of the top ${comma(DEPTH_MAX)} m. ` +
      `With low emissions, after CO₂ peaks in ${peakYr} the surface stays about level while the top ${comma(DEPTH_MAX)} m keeps warming, reaching ${sign(TS.ssp126.at(-1).top, 2)} °C by 2100 (high emissions: ${sign(TS.ssp585.at(-1).top, 2)} °C).`);
    svg.append("rect").attr("x", x(2014)).attr("y", m.t).attr("width", x(2100) - x(2014)).attr("height", h - m.b - m.t).attr("fill", "currentColor").attr("opacity", .05);
    svg.append("text").attr("class", "muted").attr("x", x(2014) + 8).attr("y", m.t + 12).text("Projection →");
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.floor((x.range()[1] - m.l) / 90))).tickFormat(d3.format("d")));
    svg.append("text").attr("class", "muted").attr("x", x.range()[1]).attr("y", h - 6).attr("text-anchor", "end").text("Year · warming in °C vs 1995–2014");
    const Y = {};
    for (const P of panels) {
      const y = Y[P.key] = d3.scaleLinear(d3.extent(SC.flatMap(e => TS[e].map(d => d[P.key])).concat(0)), [P.bot, P.top]).nice(4);
      svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(x.range()[1] - m.l)).tickFormat(""));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d => sign(d, 1)));
      svg.append("line").attr("x1", m.l).attr("x2", x.range()[1]).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "currentColor").attr("opacity", .45);
      svg.append("text").attr("class", "lbl").attr("x", m.l).attr("y", P.top - 8).text(P.title);
      const ln = d3.line().x(d => x(d.y)).y(d => y(d[P.key])).curve(d3.curveMonotoneX);
      for (const e of SC) svg.append("path").datum(TS[e]).attr("fill", "none").style("stroke", VAR[e]).attr("stroke-width", e === "historical" ? 2 : 2.5).attr("d", ln);
      const lo = TS.ssp126.at(-1), hi = TS.ssp585.at(-1);
      if (F.wide) endLabels(svg, F, x, [ // on small charts they'd sit on the lines; the pair line and hover carry the values
        { key: "ssp585", name: "High emissions", value: `${sign(hi[P.key], 2)} °C in 2100`, y: y(hi[P.key]), color: VAR.ssp585 },
        { key: "ssp126", name: "Low emissions", value: `${sign(lo[P.key], 2)} °C in 2100`, y: y(lo[P.key]), color: VAR.ssp126 }
      ]);
      // the low-emissions CO₂ peak, on both panels
      const pv = TS.ssp126.find(d => d.y === peakYr);
      svg.append("line").attr("x1", x(peakYr)).attr("x2", x(peakYr)).attr("y1", P.top).attr("y2", P.bot).style("stroke", VAR.ssp126).attr("stroke-dasharray", "3 4").attr("opacity", .6);
      svg.append("circle").attr("cx", x(peakYr)).attr("cy", y(pv[P.key])).attr("r", 4.5).style("fill", VAR.ssp126).attr("stroke", "#fff").attr("stroke-width", 1.5);
    }
    svg.append("text").attr("class", "sub halo").attr("x", x(peakYr) - 6).attr("y", panels[0].top + 12).attr("text-anchor", "end").style("fill", VAR.ssp126)
      .text(F.wide ? `${peakYr}: low-emissions CO₂ peaks` : `CO₂ peaks ${peakYr}`);
    // hover: one year, both panels
    const hover = svg.append("g").style("display", "none").style("pointer-events", "none");
    hover.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "currentColor").attr("opacity", .4);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", x.range()[1] - m.l).attr("height", h - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", ev => {
        const yr = Math.max(1950, Math.min(2100, Math.round(x.invert(d3.pointer(ev)[0]))));
        const rows = (yr <= 2014 ? ["historical"] : ["ssp126", "ssp585"]).map(e => [e, TS[e].find(d => d.y === yr)]);
        hover.style("display", null).select("line").attr("x1", x(yr)).attr("x2", x(yr));
        hover.selectAll("circle").data(panels.flatMap(P => rows.map(([e, d]) => ({ e, cy: Y[P.key](d[P.key]) })))).join("circle")
          .attr("r", 4.5).attr("cx", x(yr)).attr("cy", d => d.cy).style("fill", d => VAR[d.e]).attr("stroke", "#fff").attr("stroke-width", 1.5);
        showTip(ev, `<b>${yr}</b>${yr > 2014 ? " · projected" : ""}<br>` + rows.map(([e, d]) => `${NAME[e]}: surface ${sign(d.surf, 2)} °C, top ${comma(DEPTH_MAX)} m ${sign(d.top, 2)} °C`).join("<br>"));
      }).on("mouseleave", () => { hover.style("display", "none"); hideTip(); });
  }
  function buildDepth() {
    const F = frame(el, { h: 440 }), { svg, h, m } = F;
    const x = d3.scaleLinear([Math.min(-0.2, d3.min(all, d => d.v)), d3.max(all, d => d.v)], [m.l, F.w - m.r]).nice();
    const y = d3.scaleLinear([0, DEPTH_MAX], [m.t + 6, h - m.b]);
    axes(F, x, y, "Warming since 1950–1979 (°C)", "Depth (m)", d => sign(d, 1), d => comma(d));
    svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "currentColor").attr("opacity", .45);
    svg.append("line").attr("x1", m.l).attr("x2", x.range()[1]).attr("y1", y(MARK)).attr("y2", y(MARK)).attr("stroke", "currentColor").attr("stroke-dasharray", "3 4").attr("opacity", .45);
    svg.append("text").attr("class", "muted").attr("x", x.range()[1]).attr("y", y(MARK) - 6).attr("text-anchor", "end").text(`${comma(MARK)} m`);
    const ln = d3.line().x(d => x(d.v)).y(d => y(d.z)).curve(d3.curveMonotoneY);
    // where history ended, for reference once the futures split
    const ref = svg.append("path").datum(prof("historical", 2014)).attr("fill", "none").style("stroke", VAR.historical).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3").attr("d", ln);
    const refLbl = svg.append("text").attr("class", "sub halo").style("fill", VAR.historical).text("2014");
    const g = svg.append("g"), lbl = svg.append("g");
    const hover = svg.append("g").style("display", "none");
    hover.append("line").attr("x1", m.l).attr("x2", x.range()[1]).attr("stroke", "currentColor").attr("opacity", .4);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", x.range()[1] - m.l).attr("height", h - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", ev => {
        const d = Math.max(z[0], Math.min(DEPTH_MAX, y.invert(d3.pointer(ev)[1]))), S = series();
        hover.style("display", null).select("line").attr("y1", y(d)).attr("y2", y(d));
        hover.selectAll("circle").data(S).join("circle").attr("r", 4.5).attr("cx", s => x(at(s[1], d))).attr("cy", y(d)).style("fill", s => VAR[s[0]]).attr("stroke", "#fff").attr("stroke-width", 1.5);
        showTip(ev, `<b>${comma(Math.round(d / 10) * 10)} m · ${yr}</b>${yr > 2014 ? " · projected" : ""}<br>` + S.map(s => `${NAME[s[0]]}: ${sign(at(s[1], d), 2)} °C`).join("<br>"));
      }).on("mouseleave", () => { hover.style("display", "none"); hideTip(); });
    draw = () => {
      const S = series();
      g.selectAll("path").data(S, s => s[0]).join("path").attr("fill", "none").style("stroke", s => VAR[s[0]]).attr("stroke-width", 3).attr("d", s => ln(s[1]));
      ref.attr("opacity", yr > 2014 ? .8 : 0); refLbl.attr("opacity", yr > 2014 ? 1 : 0)
        .attr("x", x(prof("historical", 2014)[0].v) - 8).attr("y", y(z[0]) + 12).attr("text-anchor", "end");
      // surface values, labelled at the top of each line and nudged apart
      const tops = S.map(s => ({ e: s[0], v: s[1][0].v, px: x(s[1][0].v) })).sort((a, b) => a.px - b.px);
      for (let i = 1; i < tops.length; i++) if (tops[i].px - tops[i - 1].px < 110) tops[i].px = tops[i - 1].px + 110;
      lbl.selectAll("text").data(tops, t => t.e).join("text").attr("class", "lbl halo").attr("y", m.t - 4).attr("text-anchor", "middle")
        .attr("x", t => Math.min(x.range()[1] + (F.wide ? 60 : -30), Math.max(m.l + 90, t.px))).style("fill", t => VAR[t.e])
        .text(t => `${t.e === "historical" ? "" : t.e === "ssp126" ? "Low " : "High "}${sign(t.v, 1)} °C`);
      svg.attr("aria-label", `Line chart of ocean warming by depth in ${yr}, compared with 1950–1979, from the surface down to ${comma(DEPTH_MAX)} m. ` +
        S.map(s => `${NAME[s[0]]}: ${sign(s[1][0].v, 2)} °C at the surface and ${sign(at(s[1], MARK), 2)} °C at ${comma(MARK)} m.`).join(" "));
    };
    draw();
  }
  function upd() {
    if (view === "time") {
      // what happens after the CO₂ peak, as 10-year averages so one warm or cool year doesn't decide it
      const a = peakYr - 5, b = peakYr + 5, chg = key => avgOf("ssp126", key, 2091, 2100) - avgOf("ssp126", key, a, b);
      $("#depthPair").innerHTML = `Low emissions, ${peakYr} → 2100 (10-year averages): surface <b class="lo">${sign(chg("surf"), 2)} °C</b> · top ${comma(DEPTH_MAX)} m <b class="lo">${sign(chg("top"), 2)} °C</b>`;
      return;
    }
    $("#depthYear").value = yr; $("#depthYearLbl").textContent = yr;
    $("#depthProj").hidden = yr <= 2014;
    $("#depthYear").setAttribute("aria-valuetext", yr + (yr > 2014 ? ", projected" : ""));
    const S = series();
    $("#depthPair").innerHTML = yr <= 2014
      ? pairHTML(`Warming at ${comma(MARK)} m, ${yr}`, 0, 0, " °C", sign(at(S[0][1], MARK), 2))
      : pairHTML(`Warming at ${comma(MARK)} m, ${yr}`, sign(at(S[0][1], MARK), 2), sign(at(S[1][1], MARK), 2), " °C");
    draw && draw();
  }
  const btn = $("#depthPlay");
  const stop = player(btn, () => yr, v => { yr = v; upd(); });
  d3.select("#depthYear").on("input", function () { stop(); yr = +this.value; upd(); });
  // Play and the year slider only drive the depth view
  seg("#depthView", "v", v => {
    view = v; stop();
    btn.style.display = $("#depthYearCtl").style.display = v === "time" ? "none" : "";
    build(); upd();
  });
  build(); upd(); renderers.push(() => { build(); upd(); });
}

/* ================= DEEP: sea level ================= */
function seaLevelChart(G) {
  const el = $("#slChart");
  const models = Object.keys(G.sealevel);
  let view = "range", cur = null, xh = null;
  const agg = e => G.years[e].map((yr, i) => { const v = models.map(k => G.sealevel[k][e]?.[i]).filter(v => v != null); return { y: yr, v: d3.mean(v), lo: d3.min(v), hi: d3.max(v) }; });
  const S = { historical: agg("historical"), ssp126: agg("ssp126"), ssp585: agg("ssp585") };
  const per = (k, e) => G.years[e].map((yr, i) => ({ y: yr, v: G.sealevel[k][e]?.[i] })).filter(d => d.v != null);
  const mean = e => e === "historical" ? S[e] : [S.historical.at(-1), ...S[e]];
  const setView = animate => {
    const sel = d3.select(el), t = d3.transition().duration(animate && !reduced.matches ? UI_MS : 0).ease(EASE_OUT);
    sel.select(".bands").transition(t).attr("opacity", view === "range" ? 1 : 0);
    sel.select(".models").style("pointer-events", view === "models" ? null : "none").transition(t).attr("opacity", view === "models" ? 1 : 0);
    xh?.style("pointer-events", view === "models" ? "none" : null); // let the individual model lines take the hover
  };
  function build() {
    cur?.stop();
    const F = frame(el, { h: 420 }), { svg, h, m } = F;
    const all = Object.values(S).flat();
    const x = d3.scaleLinear([1950, 2100], [m.l, F.w - m.r]), y = d3.scaleLinear([d3.min(all, d => d.lo), d3.max(all, d => d.hi)], [h - m.b, m.t]).nice();
    const lo = S.ssp126.at(-1), hi = S.ssp585.at(-1);
    svg.attr("aria-label", `Line chart of sea level rise from ocean warming, 1950 to 2100, relative to 1995–2014. By 2100 the model average reaches ${sign(lo.v)} cm with low emissions and ${sign(hi.v)} cm with high emissions.`);
    svg.append("rect").attr("x", x(2014)).attr("y", m.t).attr("width", x(2100) - x(2014)).attr("height", h - m.b - m.t).attr("fill", "currentColor").attr("opacity", .05);
    axes(F, x, y, "Year", "Sea level from ocean warming (cm, vs 1995–2014)", d3.format("d"), d => sign(d, 0));
    svg.append("line").attr("x1", m.l).attr("x2", x.range()[1]).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "currentColor").attr("opacity", .45);
    const area = d3.area().x(d => x(d.y)).y0(d => y(d.lo)).y1(d => y(d.hi)).curve(d3.curveMonotoneX);
    const ln = d3.line().x(d => x(d.y)).y(d => y(d.v)).curve(d3.curveMonotoneX);
    const plot = svg.append("g"), labels = svg.append("g");
    const bands = plot.append("g").attr("class", "bands"), mods = plot.append("g").attr("class", "models");
    for (const e of SC) {
      bands.append("path").datum(mean(e)).style("fill", VAR[e]).attr("opacity", .2).attr("d", area);
      for (const k of models) mods.append("path").datum(per(k, e)).attr("fill", "none").style("stroke", VAR[e]).attr("stroke-width", 1.2).attr("opacity", .75).attr("d", ln)
        .on("mousemove", ev => showTip(ev, `<b>${k}</b><br>${NAME[e]}`)).on("mouseleave", hideTip);
    }
    for (const e of SC) plot.append("path").datum(mean(e)).attr("fill", "none").style("stroke", VAR[e]).attr("stroke-width", 3).attr("d", ln).style("pointer-events", "none");
    endLabels(labels, F, x, [
      { key: "ssp585", name: "High emissions", value: `${sign(hi.v)} cm by 2100`, y: y(hi.v), color: VAR.ssp585 },
      { key: "ssp126", name: "Low emissions", value: `${sign(lo.v)} cm by 2100`, y: y(lo.v), color: VAR.ssp126 }
    ]);
    gapBracket(labels, F, x, y(hi.v) + 26, y(lo.v) - 8, `${(hi.v - lo.v).toFixed(1)} cm apart`);
    const pk = co2PeakYear(G), pkV = S.ssp126.find(d => d.y === pk).v;
    yearMarker(labels, F, x, y, pk, pkV, F.wide ? `${pk}: CO₂ peaks, but the water keeps rising` : `Still rising after ${pk}`, { color: VAR.ssp126, dx: 12, dy: 40, anchor: "start" });
    svg.append("text").attr("class", "muted").attr("x", x(2014) + 8).attr("y", m.t + 16).text("Projection →");
    svg.append("text").attr("class", "muted").attr("x", m.l).attr("y", h - 6).text(F.wide ? "Models: " + models.join(", ") : models.length + " models");
    xh = crosshair(svg, F, x, y, yr => SC.map(e => { const r = S[e].find(d => d.y === yr); return r ? [e, r.v] : null; }).filter(Boolean), v => sign(v) + " cm (model average)");
    setView(false);
    cur = revealer(svg, F, x, y, plot, labels, SC.map(e => ({ e, d: mean(e) })), () => new Set(SC), SPLIT_PACE);
  }
  seg("#slView", "v", v => { view = v; setView(true); });
  $("#slReplay").addEventListener("click", () => cur.reveal());
  build(); renderers.push(build);
  armReveal("sl", () => cur);
}
