/**
 * pdf_sandbox.js — Runs Mozilla PDF.js inside the Manifest V3 Sandbox Page
 * Renders PDF pages onto high-DPI canvases and extracts exact text bounding coordinates
 * so content.js can mount a native selectable HTML text layer directly in the main document!
 */

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function base64ToUint8Array(b64) {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

window.addEventListener('message', async (e) => {
  const data = e.data;
  if (!data || data.type !== 'DS_RENDER_PDF_BASE64') return;

  try {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('pdfjsLib not loaded');
    }
    const bytes = base64ToUint8Array(data.base64);
    const scale = data.scale || 1.45;
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

    e.source.postMessage({
      type: 'DS_PDF_META',
      numPages: pdf.numPages
    }, '*');

    const dpr = Math.min(2, window.devicePixelRatio || 1.5);

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const renderViewport = page.getViewport({ scale: scale * dpr });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport: renderViewport
      }).promise;

      const textContent = await page.getTextContent();
      const items = [];

      for (const item of textContent.items) {
        if (!item.str) continue;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        const left = tx[4];
        const top = tx[5] - fontHeight * 0.84;
        const width = (item.width || 0) * viewport.scale;
        items.push({
          str: item.str + (item.hasEOL ? ' ' : ''),
          left,
          top,
          width,
          fontHeight
        });
      }

      e.source.postMessage({
        type: 'DS_PDF_PAGE',
        pageNum,
        width: viewport.width,
        height: viewport.height,
        dataUrl: canvas.toDataURL('image/jpeg', 0.92),
        items
      }, '*');
    }
  } catch (err) {
    e.source.postMessage({
      type: 'DS_PDF_ERROR',
      error: err.message || 'Failed to render PDF'
    }, '*');
  }
});
