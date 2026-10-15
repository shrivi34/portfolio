// A small, live RANSAC demo: noisy points along a line plus outliers.
// RANSAC samples random pairs, keeps the line with the most inliers,
// then refits on those inliers. Least squares on all points is shown dashed.
(() => {
  const canvas = document.getElementById('ransac');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('ransac-status');
  const resetBtn = document.getElementById('ransac-reset');
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  const ITERATIONS = 45;
  const STEP_MS = 75;
  const THRESHOLD = 0.04; // perpendicular distance, in data units (0..1)

  let points = [];
  let lsLine = null;      // { m, c }
  let best = null;        // { m, c, inliers: Set }
  let candidate = null;   // { m, c, pair: [i, j] }
  let iteration = 0;
  let timer = null;
  let finished = false;

  const rand = (a, b) => a + Math.random() * (b - a);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function makeData() {
    const m = rand(0.5, 0.72);
    const c = rand(0.1, 0.2);
    const pts = [];
    for (let i = 0; i < 42; i++) {
      const x = rand(0.04, 0.96);
      pts.push({ x, y: clamp(m * x + c + gauss() * 0.016, 0.02, 0.98) });
    }
    // A cluster of bad readings in the lower right, which drags least squares down.
    const cx = rand(0.72, 0.88), cy = rand(0.08, 0.18);
    for (let i = 0; i < 11; i++) {
      pts.push({ x: clamp(cx + gauss() * 0.05, 0.02, 0.98), y: clamp(cy + gauss() * 0.04, 0.02, 0.98) });
    }
    // Scattered noise.
    for (let i = 0; i < 9; i++) {
      pts.push({ x: rand(0.04, 0.96), y: rand(0.04, 0.96) });
    }
    return pts;
  }

  function leastSquares(pts) {
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-9) return { m: 0, c: sy / n };
    const m = (n * sxy - sx * sy) / denom;
    return { m, c: (sy - m * sx) / n };
  }

  function inliersOf(line) {
    const set = new Set();
    const norm = Math.sqrt(line.m * line.m + 1);
    points.forEach((p, i) => {
      if (Math.abs(line.m * p.x - p.y + line.c) / norm < THRESHOLD) set.add(i);
    });
    return set;
  }

  function step() {
    let i, j, tries = 0;
    do {
      i = Math.floor(Math.random() * points.length);
      j = Math.floor(Math.random() * points.length);
      tries++;
    } while ((i === j || Math.abs(points[i].x - points[j].x) < 0.08) && tries < 50);

    const a = points[i], b = points[j];
    const m = (b.y - a.y) / (b.x - a.x);
    const line = { m, c: a.y - m * a.x };
    const inliers = inliersOf(line);
    candidate = { ...line, pair: [i, j] };
    if (!best || inliers.size > best.inliers.size) best = { ...line, inliers };
    iteration++;
  }

  function finish() {
    // Refit on the consensus set, then recompute who agrees with the refined line.
    const refined = leastSquares([...best.inliers].map((k) => points[k]));
    best = { ...refined, inliers: inliersOf(refined) };
    candidate = null;
    finished = true;
    const outliers = points.length - best.inliers.size;
    setStatus(`Best line fits ${best.inliers.size} of ${points.length} points. ${outliers} outliers ignored.`);
  }

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  // Drawing
  function colors() {
    const s = getComputedStyle(document.documentElement);
    const v = (name) => s.getPropertyValue(name).trim();
    return { ink: v('--ink'), graphite: v('--graphite'), mist: v('--mist'), marigold: v('--marigold') };
  }

  let W = 0, H = 0, PAD = 20;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    PAD = Math.max(16, Math.round(Math.min(W, H) * 0.06));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  const px = (x) => PAD + x * (W - 2 * PAD);
  const py = (y) => H - PAD - y * (H - 2 * PAD);

  function drawLine(line, opts) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD, PAD, W - 2 * PAD, H - 2 * PAD);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(px(0), py(line.c));
    ctx.lineTo(px(1), py(line.m + line.c));
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = opts.width;
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.setLineDash(opts.dash || []);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    if (!W || !H) return;
    const c = colors();
    ctx.clearRect(0, 0, W, H);

    // Axes
    ctx.strokeStyle = c.mist;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, PAD);
    ctx.lineTo(PAD, H - PAD);
    ctx.lineTo(W - PAD, H - PAD);
    ctx.stroke();

    const r = Math.max(3, Math.min(W, H) * 0.0105);

    if (lsLine) drawLine(lsLine, { color: c.graphite, width: 1.5, dash: [6, 6], alpha: 0.9 });
    if (candidate) drawLine(candidate, { color: c.graphite, width: 1, alpha: 0.55 });
    if (best) drawLine(best, { color: c.ink, width: finished ? 2.5 : 2, alpha: finished ? 1 : 0.75 });

    points.forEach((p, i) => {
      const isIn = best && best.inliers.has(i);
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), r, 0, Math.PI * 2);
      if (isIn) {
        ctx.fillStyle = c.marigold;
        ctx.fill();
      } else {
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = c.graphite;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });

    if (candidate) {
      for (const k of candidate.pair) {
        const p = points[k];
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.y), r * 2.2, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = c.ink;
        ctx.stroke();
      }
    }
  }

  function run() {
    clearInterval(timer);
    points = makeData();
    lsLine = leastSquares(points);
    best = null;
    candidate = null;
    iteration = 0;
    finished = false;

    if (reduceMotion.matches) {
      while (iteration < ITERATIONS) step();
      finish();
      draw();
      return;
    }

    setStatus(`Trying lines through random pairs of points…`);
    draw();
    timer = setInterval(() => {
      step();
      setStatus(`Try ${iteration} of ${ITERATIONS}. Best so far fits ${best.inliers.size} points.`);
      if (iteration >= ITERATIONS) {
        clearInterval(timer);
        finish();
      }
      draw();
    }, STEP_MS);
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }
  const onScheme = () => draw();
  if (darkScheme.addEventListener) darkScheme.addEventListener('change', onScheme);

  resetBtn && resetBtn.addEventListener('click', run);

  resize();
  // Let the page settle before the one moment of motion on it.
  setTimeout(run, reduceMotion.matches ? 0 : 450);
})();
