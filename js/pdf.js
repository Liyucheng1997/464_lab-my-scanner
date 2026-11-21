// 极简 PDF 生成：每页放一张 JPEG，A4 纸，图片等比铺满并居中。

const A4 = [595.28, 841.89];

/** pages: [{ bytes: Uint8Array(JPEG), w, h }] → Blob(application/pdf) */
export function buildPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const u8 = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(u8);
    pos += u8.length;
  };
  const obj = (num, body) => {
    offsets[num] = pos;
    push(`${num} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  const f = (v) => v.toFixed(2);

  push('%PDF-1.4\n%âãÏÓ\n');
  const total = 2 + pages.length * 3;
  const pageNum = (i) => 3 + i * 3;

  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] >>`));

  pages.forEach((p, i) => {
    const landscape = p.w > p.h;
    const pw = landscape ? A4[1] : A4[0];
    const ph = landscape ? A4[0] : A4[1];
    const k = Math.min(pw / p.w, ph / p.h);
    const dw = p.w * k, dh = p.h * k;
    const dx = (pw - dw) / 2, dy = (ph - dh) / 2;
    const n = pageNum(i);
    const content = `q ${f(dw)} 0 0 ${f(dh)} ${f(dx)} ${f(dy)} cm /Im0 Do Q`;

    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    obj(n + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(n + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
      push(p.bytes);
      push('\nendstream');
    });
  });

  const xref = pos;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= total; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
