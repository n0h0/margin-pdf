import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getPageLinks } from '../src/lib/pdf-links';
import { createLinkPdf } from './fixtures/pdf-links';

let task: ReturnType<typeof getDocument>;
let pdf: PDFDocumentProxy;
beforeAll(async () => {
  task = getDocument({ data: createLinkPdf(), verbosity: 0 });
  pdf = await task.promise;
});
afterAll(async () => { await task?.destroy(); });

describe('PDF links', () => {
  it('resolves explicit and named links from PDF annotations to reader pages', async () => {
    const page = await pdf.getPage(2);
    const links = await getPageLinks(pdf, page, page.getViewport({ scale: 1 }));
    expect(pdf.numPages).toBe(4);
    expect(links.map(link => link.page)).toEqual([4, 3]);
  });

  it('preserves an external URL and keeps its hit area aligned through zoom and rotation', async () => {
    const page = await pdf.getPage(4);
    const [normal] = await getPageLinks(pdf, page, page.getViewport({ scale: 1 }));
    const [zoomed] = await getPageLinks(pdf, page, page.getViewport({ scale: 2 }));
    const [rotated] = await getPageLinks(pdf, page, page.getViewport({ scale: 1, rotation: 90 }));
    expect(normal.url).toBe('https://example.com/reading');
    expect(normal.rect).toEqual({ x: 0.1, y: 0.2, width: 0.2, height: 0.1 });
    expect(zoomed.rect).toEqual(normal.rect);
    expect(rotated.rect.x).toBeCloseTo(1 - normal.rect.y - normal.rect.height);
    expect(rotated.rect.y).toBeCloseTo(normal.rect.x);
    expect(rotated.rect.width).toBeCloseTo(normal.rect.height);
    expect(rotated.rect.height).toBeCloseTo(normal.rect.width);
  });

  it('supports named destinations and zero-based explicit page indexes', async () => {
    const page = await pdf.getPage(2);
    const annotations = vi.spyOn(page, 'getAnnotations').mockResolvedValue([
      { id: 'named', subtype: 'Link', rect: [10, 10, 20, 20], dest: 'chapter' },
      { id: 'indexed', subtype: 'Link', rect: [10, 10, 20, 20], dest: [0, { name: 'Fit' }] },
    ]);
    const destination = vi.spyOn(pdf, 'getDestination').mockResolvedValue([3, { name: 'Fit' }]);
    try {
      const links = await getPageLinks(pdf, page, page.getViewport({ scale: 1 }));
      expect(links.map(link => link.page)).toEqual([4, 1]);
    } finally { annotations.mockRestore(); destination.mockRestore(); }
  });

  it('ignores unsafe URLs and broken destinations while preserving usable links', async () => {
    const page = await pdf.getPage(4);
    const base = { subtype: 'Link', rect: [10, 10, 20, 20] };
    const annotations = vi.spyOn(page, 'getAnnotations').mockResolvedValue([
      { ...base, id: 'unsafe', url: 'javascript:alert(1)' },
      { ...base, id: 'unvalidated', unsafeUrl: 'https://example.com' },
      { ...base, id: 'missing', dest: 'missing-destination' },
      { ...base, id: 'out-of-range', dest: [pdf.numPages, { name: 'Fit' }] },
      { ...base, id: 'empty', rect: [10, 10, 10, 10], url: 'https://example.com' },
      { ...base, id: 'valid', url: 'https://example.com/' },
    ]);
    const destination = vi.spyOn(pdf, 'getDestination').mockRejectedValue(new Error('Invalid destination'));
    try {
      const links = await getPageLinks(pdf, page, page.getViewport({ scale: 1 }));
      expect(links.map(link => link.id)).toEqual(['valid']);
    } finally { annotations.mockRestore(); destination.mockRestore(); }
  });
});
