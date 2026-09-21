/**
 * Original four-page PDF fixture, generated entirely in memory.
 * Page 2 links to pages 4 and 3; page 4 links to example.com.
 * No book contents, fonts, images, or external files are embedded.
 */
export function createLinkPdf(): Uint8Array {
  const page = (annotations = '') => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << >> ${annotations} >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(chapter-three) [5 0 R /Fit]] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 4 >>',
    page(),
    page('/Annots [7 0 R 8 0 R]'),
    page(),
    page('/Annots [9 0 R]'),
    '<< /Type /Annot /Subtype /Link /Rect [20 200 80 220] /Dest [6 0 R /Fit] >>',
    '<< /Type /Annot /Subtype /Link /Rect [20 160 80 180] /Dest (chapter-three) >>',
    '<< /Type /Annot /Subtype /Link /Rect [20 210 60 240] /A << /S /URI /URI (https://example.com/reading) >> >>',
  ];
  // All fixture content is ASCII, so character offsets are also byte offsets.
  let document = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = document.length;
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}
