import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { SelectionRect } from './schema';

export type PdfLink = { id: string; rect: SelectionRect } & (
  { url: string; page?: never } | { page: number; url?: never }
);

interface LinkAnnotation {
  id: string;
  subtype: string;
  rect: number[];
  url?: string;
  dest?: string | unknown[];
  action?: string;
}

export async function getPageLinks(pdf: PDFDocumentProxy, page: PDFPageProxy, viewport: ReturnType<PDFPageProxy['getViewport']>): Promise<PdfLink[]> {
  const annotations: LinkAnnotation[] = await page.getAnnotations({ intent: 'display' });
  const links = await Promise.all(annotations.map(async (annotation): Promise<PdfLink | null> => {
    if (annotation.subtype !== 'Link' || annotation.rect?.length !== 4 || !annotation.rect.every(Number.isFinite)) return null;
    const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
    const rect = {
      x: Math.min(x1, x2) / viewport.width, y: Math.min(y1, y2) / viewport.height,
      width: Math.abs(x2 - x1) / viewport.width, height: Math.abs(y2 - y1) / viewport.height,
    };
    if (!rect.width || !rect.height) return null;
    try {
      // Only use PDF.js's validated URL, never the annotation's unsafeUrl or scripts.
      if (annotation.url) {
        const url = new URL(annotation.url);
        if (!['http:', 'https:', 'mailto:', 'tel:', 'ftp:'].includes(url.protocol)) return null;
        return { id: annotation.id, rect, url: url.href };
      }
      let target: number | undefined;
      if (annotation.dest) {
        const destination = typeof annotation.dest === 'string' ? await pdf.getDestination(annotation.dest) : annotation.dest;
        const ref = destination?.[0];
        if (typeof ref === 'number') target = ref + 1;
        else if (ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref && typeof ref.num === 'number' && typeof ref.gen === 'number') {
          target = await pdf.getPageIndex({ num: ref.num, gen: ref.gen }) + 1;
        }
      } else {
        switch (annotation.action) {
          case 'FirstPage': target = 1; break;
          case 'LastPage': target = pdf.numPages; break;
          case 'NextPage': target = Math.min(page.pageNumber + 1, pdf.numPages); break;
          case 'PrevPage': target = Math.max(page.pageNumber - 1, 1); break;
        }
      }
      if (target !== undefined && Number.isInteger(target) && target >= 1 && target <= pdf.numPages) {
        return { id: annotation.id, rect, page: target };
      }
    } catch { /* Ignore a malformed link without preventing the page from rendering. */ }
    return null;
  }));
  return links.filter((link): link is PdfLink => link !== null);
}
