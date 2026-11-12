'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { PDFViewer, PDFLinkService } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { ChevronLeft, ChevronRight, Minus, Plus, ScanLine } from 'lucide-react';
import { Button } from './ui/button';
import { digits } from '@/lib/utils';
import { MAX_PREVIEW_BYTES, previewBytes } from '@/lib/preview-bytes';

export function PdfPreview({ url, size }: { url: string; size?: number | null }) {
  const container = useRef<HTMLDivElement>(null);
  const viewerElement = useRef<HTMLDivElement>(null);
  const viewer = useRef<PDFViewer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const abort = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    let instance: PDFViewer | undefined;
    let links: PDFLinkService | undefined;
    let resize: ResizeObserver | undefined;
    let frame = 0;

    async function load() {
      try {
        if (size && size > MAX_PREVIEW_BYTES)
          throw new Error('این فایل برای پیش‌نمایش بزرگ است؛ آن را دریافت کنید.');
        const bytes = await previewBytes(url, abort.signal);
        const pdfjs = await import('pdfjs-dist');
        // The official viewer consumes the matching API's global export.
        const { PDFViewer, EventBus, PDFLinkService, LinkTarget } =
          await import('pdfjs-dist/web/pdf_viewer.mjs');
        if (abort.signal.aborted || !container.current || !viewerElement.current) return;
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const eventBus = new EventBus();
        links = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
        const options: ConstructorParameters<typeof PDFViewer>[0] & { abortSignal: AbortSignal } = {
          container: container.current,
          viewer: viewerElement.current,
          eventBus,
          linkService: links,
          abortSignal: abort.signal,
          // Preview documents without executing PDF scripts or interactive forms.
          annotationMode: pdfjs.AnnotationMode.ENABLE,
          enableAutoLinking: false,
          maxCanvasPixels: 8 * 1024 * 1024,
          maxCanvasDim: 8192,
        };
        instance = new PDFViewer(options);
        links.setViewer(instance);
        viewer.current = instance;
        eventBus.on('pagesinit', () => {
          if (abort.signal.aborted || !instance) return;
          instance.currentScaleValue = 'page-width';
          setPages(instance.pagesCount);
        });
        eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
          if (!abort.signal.aborted) setPage(pageNumber);
        });
        eventBus.on('scalechanging', ({ scale }: { scale: number }) => {
          if (!abort.signal.aborted) setScale(scale);
        });
        eventBus.on('pagerendered', ({ error }: { error?: Error }) => {
          if (abort.signal.aborted) return;
          if (error) setError('نمایش این صفحه انجام نشد. دوباره تلاش کنید یا فایل را دریافت کنید.');
          setLoading(false);
        });
        task = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          cMapUrl: '/pdf-assets/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdf-assets/standard_fonts/',
          wasmUrl: '/pdf-assets/wasm/',
          // Keep embedded fonts and PDF glyph mappings; never replace PDF text with HTML.
          disableFontFace: false,
          enableXfa: false,
        });
        const document = await task.promise;
        if (abort.signal.aborted) return;
        links.setDocument(document);
        instance.setDocument(document);
        // Surface initialization failures (including malformed page trees).
        void instance.pagesPromise?.catch(() => {
          if (!abort.signal.aborted) {
            setError('آماده‌سازی صفحات فایل انجام نشد. دوباره تلاش کنید.');
            setLoading(false);
          }
        });
        let previousWidth = container.current.clientWidth;
        resize = new ResizeObserver(() => {
          const width = container.current?.clientWidth;
          if (!width || width === previousWidth) return;
          previousWidth = width;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (!abort.signal.aborted && instance?.currentScaleValue === 'page-width') {
              instance.currentScaleValue = 'page-width';
              instance.update();
            }
          });
        });
        resize.observe(container.current);
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'پیش‌نمایش فایل انجام نشد.');
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      resize?.disconnect();
      instance?.setDocument(null);
      links?.setDocument(null);
      void instance?.l10n?.destroy();
      if (viewer.current === instance) viewer.current = null;
      void task?.destroy().catch(() => {});
    };
  }, [url, size, attempt]);

  function retry() {
    setError('');
    setLoading(true);
    setPage(1);
    setPages(0);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="pdf-preview">
      <div className="pdf-preview-toolbar" aria-label="ابزارهای نمایش پی‌دی‌اف">
        <div className="preview-pagination">
          <Button
            variant="outline"
            size="icon"
            aria-label="صفحه قبلی"
            disabled={page <= 1 || !pages}
            onClick={() => viewer.current?.previousPage()}
          >
            <ChevronRight size={17} />
          </Button>
          <span aria-live="polite">
            صفحه {digits(page)} از {digits(pages || 1)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="صفحه بعدی"
            disabled={page >= pages}
            onClick={() => viewer.current?.nextPage()}
          >
            <ChevronLeft size={17} />
          </Button>
        </div>
        <div className="pdf-preview-zoom">
          <Button
            variant="ghost"
            size="icon"
            aria-label="کوچک‌نمایی"
            disabled={!pages || scale <= 0.25}
            onClick={() => {
              if (viewer.current) viewer.current.currentScale = Math.max(0.25, scale / 1.25);
            }}
          >
            <Minus size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="اندازه عرض صفحه"
            disabled={!pages}
            onClick={() => {
              if (viewer.current) viewer.current.currentScaleValue = 'page-width';
            }}
          >
            <ScanLine size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="بزرگ‌نمایی"
            disabled={!pages || scale >= 4}
            onClick={() => {
              if (viewer.current) viewer.current.currentScale = Math.min(4, scale * 1.25);
            }}
          >
            <Plus size={17} />
          </Button>
        </div>
      </div>
      {loading && (
        <p role="status" className="field-hint">
          در حال آماده‌سازی پیش‌نمایش…
        </p>
      )}
      {error && (
        <div className="preview-error">
          <p role="alert" className="error-message">
            {error}
          </p>
          <Button variant="outline" onClick={retry}>
            تلاش دوباره
          </Button>
        </div>
      )}
      <div className="pdf-preview-frame">
        <div
          ref={container}
          className="pdf-preview-scroll preview-scroll"
          role="region"
          aria-label="صفحات فایل پی‌دی‌اف"
          tabIndex={0}
          dir="ltr"
        >
          <div ref={viewerElement} className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}
