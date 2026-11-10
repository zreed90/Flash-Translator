/**
 * pdf_main_bridge.js — Runs in Chrome's MAIN World ("world": "MAIN")
 *
 * Why this file is essential for Full-Window PDFs in Chrome:
 * Chromium binds the C++ PDF plugin method `embed.postMessage({ type: 'getSelectedText' })`
 * onto the `<embed type="application/pdf">` element in the MAIN V8 World (not the Isolated World).
 * Running this lightweight poller in the MAIN World queries Chrome's native PDF viewer every
 * 180ms so `{ type: 'getSelectedTextReply', selectedText }` is dispatched to `window` whenever
 * the user highlights text on a PDF!
 */
(() => {
  setInterval(() => {
    const pdfEmbed = document.querySelector('embed[type="application/pdf"], embed[type="application/x-google-chrome-pdf"]');
    if (pdfEmbed && typeof pdfEmbed.postMessage === 'function') {
      try {
        pdfEmbed.postMessage({ type: 'getSelectedText' });
      } catch (_) {}
    }
  }, 180);
})();
