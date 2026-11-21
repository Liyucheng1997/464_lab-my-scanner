// 图像处理：读图、纸张边缘识别、透视矫正、滤镜。全部在本机用 canvas 完成，不依赖任何库。

export const MAX_SRC = 3000; // 原图工作副本的最长边
export const MAX_OUT = 2600; // 矫正结果的最长边

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), 'image/jpeg', quality);
  });
}

/** 把图片文件解码到 canvas（浏览器会按 EXIF 自动转正），并限制最长边。 */
export async function loadToCanvas(blob, maxSide = MAX_SRC) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = makeCanvas(Math.max(1, Math.round(img.naturalWidth * k)), Math.max(1, Math.round(img.naturalHeight * k)));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function scaled(src, maxSide) {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = makeCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function thumb(src, maxSide = 420) {
  return scaled(src, maxSide).toDataURL('image/jpeg', 0.72);
}

export function rotate90(src) {
  const c = makeCanvas(src.height, src.width);
  const g = c.getContext('2d');
  g.translate(c.width, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

export const fullCorners = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export const defaultCorners = () => [{ x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 }];

/**
 * 识别纸张四角。思路：取画面四周一圈的颜色当作"桌面色"，
 * 与桌面色差异大的最大连通区域视为纸张，再取它的四个极点。
 * 返回归一化坐标 [左上, 右上, 右下, 左下]；识别不可靠时返回 null。
 */
export function detectCorners(src) {
  const small = scaled(src, 220);
  const w = small.width, h = small.height, n = w * h;
  if (w < 16 || h < 16) return null;
  const d = small.getContext('2d').getImageData(0, 0, w, h).data;

  const rs = [], gs = [], bs = [], m = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < m || y < m || x >= w - m || y >= h - m) {
        const i = (y * w + x) * 4;
        rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
      }
    }
  }
  const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const br = median(rs), bg = median(gs), bb = median(bs);

  const dist = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = Math.min(255, (Math.abs(d[p] - br) + Math.abs(d[p + 1] - bg) + Math.abs(d[p + 2] - bb)) >> 1);
    dist[i] = v;
    hist[v]++;
  }

  // 大津法求阈值
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const diff = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * diff * diff;
    if (between > best) { best = between; thr = i; }
  }
  thr = Math.max(thr, 14);

  // 最大连通区域
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  let bestLabel = 0, bestArea = 0, cur = 0;
  for (let s = 0; s < n; s++) {
    if (dist[s] <= thr || label[s]) continue;
    cur++;
    let top = 0, area = 0;
    stack[top++] = s;
    label[s] = cur;
    while (top) {
      const i = stack[--top];
      area++;
      const x = i % w;
      if (x > 0 && !label[i - 1] && dist[i - 1] > thr) { label[i - 1] = cur; stack[top++] = i - 1; }
      if (x < w - 1 && !label[i + 1] && dist[i + 1] > thr) { label[i + 1] = cur; stack[top++] = i + 1; }
      if (i >= w && !label[i - w] && dist[i - w] > thr) { label[i - w] = cur; stack[top++] = i - w; }
      if (i < n - w && !label[i + w] && dist[i + w] > thr) { label[i + w] = cur; stack[top++] = i + w; }
    }
    if (area > bestArea) { bestArea = area; bestLabel = cur; }
  }
  if (bestArea < n * 0.1) return null;

  let tl, tr, brc, bl;
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < n; i++) {
    if (label[i] !== bestLabel) continue;
    const x = i % w, y = (i / w) | 0;
    const s = x + y, df = x - y;
    if (s < minS) { minS = s; tl = { x, y }; }
    if (s > maxS) { maxS = s; brc = { x, y }; }
    if (df > maxD) { maxD = df; tr = { x, y }; }
    if (df < minD) { minD = df; bl = { x, y }; }
  }
  const q = [tl, tr, brc, bl];
  let quadArea = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    quadArea += a.x * b.y - b.x * a.y;
  }
  quadArea = Math.abs(quadArea) / 2;
  if (quadArea < n * 0.1) return null;
  const fill = bestArea / quadArea;
  if (fill < 0.75 || fill > 1.3) return null;
  return q.map((p) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h }));
}

/** 求把 from[i] 映射到 to[i] 的单应矩阵（8 个未知数，高斯消元）。 */
function homography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[8] / row[i]);
}

/** 透视矫正：把四角围成的区域拉平成矩形。 */
export function warp(src, corners, maxSide = MAX_OUT) {
  const sw = src.width, sh = src.height;
  const p = corners.map((c) => ({ x: c.x * sw, y: c.y * sh }));
  const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.max(len(p[0], p[1]), len(p[3], p[2]));
  let H = Math.max(len(p[0], p[3]), len(p[1], p[2]));
  const k = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(2, Math.round(W * k));
  H = Math.max(2, Math.round(H * k));
  const hm = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], p);
  const out = makeCanvas(W, H);
  const og = out.getContext('2d');
  if (!hm) { og.drawImage(src, 0, 0, W, H); return out; }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hm;
  const s = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const im = og.createImageData(W, H);
  const o = im.data;
  const mx = sw - 1, my = sh - 1;
  let oi = 0;
  for (let y = 0; y < H; y++) {
    const yy = y + 0.5;
    let nx = h0 * 0.5 + h1 * yy + h2;
    let ny = h3 * 0.5 + h4 * yy + h5;
    let nz = h6 * 0.5 + h7 * yy + 1;
    for (let x = 0; x < W; x++) {
      let fx = nx / nz - 0.5, fy = ny / nz - 0.5;
      if (fx < 0) fx = 0; else if (fx > mx) fx = mx;
      if (fy < 0) fy = 0; else if (fy > my) fy = my;
      const x0 = fx | 0, y0 = fy | 0;
      const x1 = x0 < mx ? x0 + 1 : x0, y1 = y0 < my ? y0 + 1 : y0;
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const t = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax;
        const b = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax;
        o[oi + c] = t + (b - t) * ay;
      }
      o[oi + 3] = 255;
      oi += 4;
      nx += h0; ny += h3; nz += h6;
    }
  }
  og.putImageData(im, 0, 0);
  return out;
}

export const FILTERS = [
  { id: 'enhance', name: '增强' },
  { id: 'bw', name: '黑白' },
  { id: 'gray', name: '灰度' },
  { id: 'original', name: '原图' },
];

/**
 * 滤镜。"增强"和"黑白"先估计每个区域的纸张底色（光照图），
 * 再用像素除以底色，把阴影和泛黄去掉、纸变白、字变深。
 */
export function applyFilter(src, filter) {
  const w = src.width, h = src.height;
  const out = makeCanvas(w, h);
  const g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  if (filter === 'original') return out;
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;

  if (filter === 'gray') {
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    g.putImageData(im, 0, 0);
    return out;
  }

  const bw = filter === 'bw';
  const cell = Math.max(8, Math.round(Math.max(w, h) / 40));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  let bgMap = [0, 1, 2].map(() => new Float32Array(gw * gh));
  const hist = [0, 1, 2].map(() => new Uint32Array(256));

  // 每格取第 85 百分位亮度作为纸张底色
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist[0].fill(0); hist[1].fill(0); hist[2].fill(0);
      const x0 = gx * cell, y0 = gy * cell;
      const x1 = Math.min(w, x0 + cell), y1 = Math.min(h, y0 + cell);
      let cnt = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0, i = (y * w + x0) * 4; x < x1; x += 2, i += 8) {
          hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++;
          cnt++;
        }
      }
      const skip = cnt * 0.15;
      for (let c = 0; c < 3; c++) {
        let acc = 0, v = 255;
        for (; v > 0; v--) { acc += hist[c][v]; if (acc > skip) break; }
        bgMap[c][gy * gw + gx] = Math.max(48, v);
      }
    }
  }

  // 先取邻域最大（跳过被文字/图片占满的格子），再模糊两次让过渡平滑
  const pass = (srcMap, fn) => {
    const dst = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const vals = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) vals.push(srcMap[yy * gw + xx]);
          }
        }
        dst[y * gw + x] = fn(vals);
      }
    }
    return dst;
  };
  const maxOf = (v) => Math.max(...v);
  const avgOf = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  bgMap = bgMap.map((mp) => pass(pass(pass(mp, maxOf), avgOf), avgOf));

  // 映射曲线：t = 像素 / 底色，t=1 对应下标 640
  const lut = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    const t = i / 640;
    let u = bw ? (t - 0.5) / (0.84 - 0.5) : (t - 0.1) / (0.9 - 0.1);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    if (bw) u = u * u * (3 - 2 * u);
    lut[i] = Math.round(u * 255);
  }

  const xi = new Int32Array(w), xf = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let f = (x + 0.5) / cell - 0.5;
    f = f < 0 ? 0 : f > gw - 1 ? gw - 1 : f;
    xi[x] = Math.min(f | 0, Math.max(0, gw - 2));
    xf[x] = gw > 1 ? f - xi[x] : 0;
  }
  const row = [0, 1, 2].map(() => new Float32Array(gw + 1));
  for (let y = 0, i = 0; y < h; y++) {
    let f = (y + 0.5) / cell - 0.5;
    f = f < 0 ? 0 : f > gh - 1 ? gh - 1 : f;
    const yA = Math.min(f | 0, Math.max(0, gh - 2));
    const yB = Math.min(yA + 1, gh - 1);
    const fy = f - yA;
    for (let c = 0; c < 3; c++) {
      const mp = bgMap[c], r = row[c];
      for (let x = 0; x < gw; x++) r[x] = mp[yA * gw + x] + (mp[yB * gw + x] - mp[yA * gw + x]) * fy;
      r[gw] = r[gw - 1];
    }
    for (let x = 0; x < w; x++, i += 4) {
      const a = xi[x], t = xf[x];
      const b0 = row[0][a] + (row[0][a + 1] - row[0][a]) * t;
      const b1 = row[1][a] + (row[1][a + 1] - row[1][a]) * t;
      const b2 = row[2][a] + (row[2][a + 1] - row[2][a]) * t;
      if (bw) {
        const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const bl = b0 * 0.299 + b1 * 0.587 + b2 * 0.114;
        let k = ((l * 640) / bl) | 0;
        if (k > 1023) k = 1023;
        d[i] = d[i + 1] = d[i + 2] = lut[k];
      } else {
        let k = ((d[i] * 640) / b0) | 0; d[i] = lut[k > 1023 ? 1023 : k];
        k = ((d[i + 1] * 640) / b1) | 0; d[i + 1] = lut[k > 1023 ? 1023 : k];
        k = ((d[i + 2] * 640) / b2) | 0; d[i + 2] = lut[k > 1023 ? 1023 : k];
      }
    }
  }
  g.putImageData(im, 0, 0);
  return out;
}
