// Renders a worksheet "figure" spec (coordinate plane + shapes) to an SVG string.
// Spec: { xRange:[-5,5], yRange:[-5,5], grid:true, elements:[ {type:"point"|"line"|"segment"|"polygon"|"circle"|"text", ...} ] }
(function () {
  const COLORS = { blue: "#2f6fed", red: "#d64545", green: "#2e9e6b", orange: "#e08a1e", purple: "#8250df", black: "#1f2430" };
  const W = 420;
  const PAD = 26;

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const color = c => COLORS[c] || (/^#[0-9a-f]{6}$/i.test(c) ? c : COLORS.blue);

  // Number line: { kind:"numberline", min, max, step, intervals:[{from,to,fromOpen,toOpen,color}], points:[{x,label,open,color}] }
  // Omit/null `from` or `to` for a ray running off to -infinity / +infinity (drawn with an arrow).
  function renderNumberLine(spec) {
    const min = num(spec.min), max = num(spec.max);
    if (!(max > min) || max - min > 60) return "";
    const step = num(spec.step) > 0 ? num(spec.step) : 1;
    const H = 90, y = 46, sx = v => PAD + (v - min) / (max - min) * (W - 2 * PAD);
    const out = [`<line x1="${PAD - 10}" y1="${y}" x2="${W - PAD + 10}" y2="${y}" stroke="#5b6275" stroke-width="2"/>`,
      `<polygon points="${PAD - 14},${y} ${PAD - 6},${y - 4} ${PAD - 6},${y + 4}" fill="#5b6275"/>`,
      `<polygon points="${W - PAD + 14},${y} ${W - PAD + 6},${y - 4} ${W - PAD + 6},${y + 4}" fill="#5b6275"/>`];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
      const r = Math.round(v * 1000) / 1000;
      out.push(`<line x1="${sx(r)}" y1="${y - 5}" x2="${sx(r)}" y2="${y + 5}" stroke="#5b6275" stroke-width="1.5"/><text x="${sx(r)}" y="${y + 20}" font-size="11" fill="#5b6275" text-anchor="middle">${r}</text>`);
    }
    const dot = (x, open, c) => `<circle cx="${sx(x)}" cy="${y}" r="6" fill="${open ? "#fff" : c}" stroke="${c}" stroke-width="2.5"/>`;
    for (const iv of Array.isArray(spec.intervals) ? spec.intervals : []) {
      const c = color(iv.color);
      const hasFrom = iv.from != null, hasTo = iv.to != null;
      const a = hasFrom ? num(iv.from) : min, b = hasTo ? num(iv.to) : max;
      out.push(`<line x1="${sx(a) - (hasFrom ? 0 : 10)}" y1="${y}" x2="${sx(b) + (hasTo ? 0 : 10)}" y2="${y}" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`);
      if (!hasFrom) out.push(`<polygon points="${PAD - 14},${y} ${PAD - 4},${y - 6} ${PAD - 4},${y + 6}" fill="${c}"/>`);
      if (!hasTo) out.push(`<polygon points="${W - PAD + 14},${y} ${W - PAD + 4},${y - 6} ${W - PAD + 4},${y + 6}" fill="${c}"/>`);
      if (hasFrom) out.push(dot(a, iv.fromOpen, c));
      if (hasTo) out.push(dot(b, iv.toOpen, c));
    }
    for (const p of Array.isArray(spec.points) ? spec.points : []) {
      const c = color(p.color), x = num(p.x);
      out.push(dot(x, p.open, c) + (p.label ? `<text x="${sx(x)}" y="${y - 14}" font-size="12" font-weight="600" fill="${c}" text-anchor="middle">${esc(p.label)}</text>` : ""));
    }
    return `<svg class="figure-svg numberline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.caption || "Number line")}" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
  }

  window.renderFigure = function (spec) {
    if (!spec || typeof spec !== "object") return "";
    if (spec.kind === "numberline") return renderNumberLine(spec);
    const [x0, x1] = Array.isArray(spec.xRange) ? spec.xRange.map(num) : [-5, 5];
    const [y0, y1] = Array.isArray(spec.yRange) ? spec.yRange.map(num) : [-5, 5];
    if (!(x1 > x0) || !(y1 > y0)) return "";

    const scale = (W - 2 * PAD) / (x1 - x0);
    const H = Math.min(560, Math.round((y1 - y0) * scale + 2 * PAD));
    const sx = x => PAD + (x - x0) * scale;
    const sy = y => H - PAD - (y - y0) * scale;
    const out = [];

    if (spec.grid !== false) {
      for (let x = Math.ceil(x0); x <= x1; x++) out.push(`<line x1="${sx(x)}" y1="${sy(y0)}" x2="${sx(x)}" y2="${sy(y1)}" stroke="#e4e7ee" stroke-width="1"/>`);
      for (let y = Math.ceil(y0); y <= y1; y++) out.push(`<line x1="${sx(x0)}" y1="${sy(y)}" x2="${sx(x1)}" y2="${sy(y)}" stroke="#e4e7ee" stroke-width="1"/>`);
    }
    if (spec.axes !== false) {
      const ax = y0 <= 0 && y1 >= 0 ? sy(0) : sy(y0);
      const ay = x0 <= 0 && x1 >= 0 ? sx(0) : sx(x0);
      out.push(`<line x1="${sx(x0)}" y1="${ax}" x2="${sx(x1)}" y2="${ax}" stroke="#5b6275" stroke-width="1.5"/>`);
      out.push(`<line x1="${ay}" y1="${sy(y0)}" x2="${ay}" y2="${sy(y1)}" stroke="#5b6275" stroke-width="1.5"/>`);
      const step = Math.max(1, Math.ceil((x1 - x0) / 10));
      for (let x = Math.ceil(x0); x <= x1; x++) if (x !== 0 && x % step === 0) out.push(`<text x="${sx(x)}" y="${ax + 14}" font-size="10" fill="#5b6275" text-anchor="middle">${x}</text>`);
      for (let y = Math.ceil(y0); y <= y1; y++) if (y !== 0 && y % step === 0) out.push(`<text x="${ay - 6}" y="${sy(y) + 3}" font-size="10" fill="#5b6275" text-anchor="end">${y}</text>`);
      out.push(`<text x="${sx(x1) - 2}" y="${ax - 6}" font-size="11" fill="#5b6275" text-anchor="end" font-style="italic">x</text>`);
      out.push(`<text x="${ay + 8}" y="${sy(y1) + 10}" font-size="11" fill="#5b6275" font-style="italic">y</text>`);
    }

    const label = (text, x, y, c) => text ? `<text x="${sx(x) + 7}" y="${sy(y) - 7}" font-size="12" font-weight="600" fill="${c}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(text)}</text>` : "";
    const dash = el => el.dashed ? ' stroke-dasharray="6 4"' : "";
    const pt = p => [num(p?.[0]), num(p?.[1])];

    for (const el of Array.isArray(spec.elements) ? spec.elements : []) {
      const c = color(el.color);
      if (el.type === "point") {
        const x = num(el.x), y = num(el.y);
        out.push(`<circle cx="${sx(x)}" cy="${sy(y)}" r="4.5" fill="${c}"/>${label(el.label, x, y, c)}`);
      } else if (el.type === "segment") {
        const [ax, ay] = pt(el.from), [bx, by] = pt(el.to);
        out.push(`<line x1="${sx(ax)}" y1="${sy(ay)}" x2="${sx(bx)}" y2="${sy(by)}" stroke="${c}" stroke-width="2.5" stroke-linecap="round"${dash(el)}/>${label(el.label, bx, by, c)}`);
      } else if (el.type === "line") {
        // Infinite line clipped to the view: either two points or slope + intercept.
        let a, b;
        if (Array.isArray(el.through) && el.through.length === 2) { a = pt(el.through[0]); b = pt(el.through[1]); }
        else { const m = num(el.slope), k = num(el.intercept); a = [0, k]; b = [1, m + k]; }
        if (a[0] === b[0]) { a = [a[0], y0]; b = [a[0], y1]; }
        else { const m = (b[1] - a[1]) / (b[0] - a[0]); const f = x => a[1] + m * (x - a[0]); b = [x1, f(x1)]; a = [x0, f(x0)]; }
        out.push(`<line x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="${c}" stroke-width="2.5" clip-path="url(#fig-clip)"${dash(el)}/>${label(el.label, b[0] - (b[0] - a[0]) * 0.12, b[1] - (b[1] - a[1]) * 0.12, c)}`);
      } else if (el.type === "polygon" && Array.isArray(el.points)) {
        const ps = el.points.map(pt);
        out.push(`<polygon points="${ps.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")}" fill="${c}" fill-opacity="${el.fill === false ? 0 : 0.15}" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"${dash(el)}/>`);
        if (el.label && ps.length) out.push(label(el.label, ps.reduce((s, p) => s + p[0], 0) / ps.length - 0.3, ps.reduce((s, p) => s + p[1], 0) / ps.length, c));
        if (el.vertices) ps.forEach(([x, y], i) => out.push(`<circle cx="${sx(x)}" cy="${sy(y)}" r="3.5" fill="${c}"/>${label(el.vertices[i], x, y, c)}`));
      } else if (el.type === "circle") {
        const [cx, cy] = pt(el.center), r = Math.abs(num(el.radius));
        out.push(`<circle cx="${sx(cx)}" cy="${sy(cy)}" r="${r * scale}" fill="${c}" fill-opacity="${el.fill === false ? 0 : 0.12}" stroke="${c}" stroke-width="2.5"${dash(el)}/>${label(el.label, cx + r * 0.7, cy + r * 0.7, c)}`);
      } else if (el.type === "text") {
        out.push(`<text x="${sx(num(el.x))}" y="${sy(num(el.y))}" font-size="12" fill="${c}">${esc(el.text)}</text>`);
      }
    }

    const defs = `<defs><clipPath id="fig-clip"><rect x="${sx(x0)}" y="${sy(y1)}" width="${sx(x1) - sx(x0)}" height="${sy(y0) - sy(y1)}"/></clipPath></defs>`;
    return `<svg class="figure-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.caption || "Diagram")}" xmlns="http://www.w3.org/2000/svg">${defs}${out.join("")}</svg>`;
  };

  // HTML for a question's visual: generated figure and/or uploaded image.
  window.renderQuestionMedia = function (q) {
    const parts = [];
    if (q.figure) parts.push(window.renderFigure(q.figure));
    if (q.image) parts.push(`<img class="figure-img" src="${esc(q.image)}" alt="Question diagram">`);
    return parts.length ? `<div class="question-media">${parts.join("")}</div>` : "";
  };
})();
