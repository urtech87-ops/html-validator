import "server-only";
import { chromium, type Browser } from "playwright-core";
import { PdfUnavailableError } from "./errors";
import { pdfFooterTemplate, renderHtml } from "./html";
import type { ReportModel } from "./model";

/**
 * PDF = the HTML report printed by headless Chromium (playwright-core).
 * One browser is shared between requests and closed after a minute idle;
 * at most two PDFs render at a time. Pages run with JavaScript disabled and
 * every network request blocked: the report is fully self-contained (the
 * logo is a data: URL), and nothing from a validated page can load anything.
 */

const IDLE_CLOSE_MS = 60_000;
const MAX_PARALLEL = 2;
const RENDER_TIMEOUT_MS = 120_000;

let browserPromise: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let active = 0;
const waiting: Array<() => void> = [];

function launch(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ args: ["--disable-dev-shm-usage", "--font-render-hinting=none"] })
      .then((browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err: unknown) => {
        browserPromise = null;
        const detail = err instanceof Error ? err.message : String(err);
        if (/Executable doesn't exist|browserType\.launch/i.test(detail)) {
          throw new PdfUnavailableError(
            "PDF reports need the Playwright Chromium shell. Run `npx playwright-core install --only-shell chromium` (see README → PDF reports), or use the Docker app.",
          );
        }
        throw err;
      });
  }
  return browserPromise;
}

async function acquire() {
  if (idleTimer) clearTimeout(idleTimer);
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release() {
  active--;
  waiting.shift()?.();
  if (active === 0) {
    idleTimer = setTimeout(() => {
      const p = browserPromise;
      browserPromise = null;
      p?.then((b) => b.close()).catch(() => {});
    }, IDLE_CLOSE_MS);
    idleTimer.unref?.();
  }
}

/** Print any self-contained HTML to an A4 PDF. Exposed for tests. */
export async function htmlToPdf(html: string, footerTemplate: string): Promise<Uint8Array> {
  await acquire();
  try {
    const browser = await launch();
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    try {
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate,
        margin: { top: "14mm", bottom: "18mm", left: "14mm", right: "14mm" },
        tagged: true,
        outline: true,
      });
      return new Uint8Array(pdf);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    release();
  }
}

export function renderPdf(model: ReportModel): Promise<Uint8Array> {
  return htmlToPdf(renderHtml(model, { forPdf: true }), pdfFooterTemplate(model));
}
