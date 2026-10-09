import { describe, expect, it } from "vitest";
import { isRtlLanguage, isValidLanguageTag, scriptStats } from "@/lib/analysis/rtl";
import { analyzeStructure } from "@/lib/analysis/structure";
import type { StructureCheck } from "@/lib/validation/types";

const page = (body: string, { head = "", htmlAttrs = 'lang="en"' } = {}) =>
  `<!DOCTYPE html>
<html ${htmlAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="A perfectly reasonable description of this test page for search engines.">
<title>A good test page title</title>
${head}
</head>
<body>
${body}
</body>
</html>`;

const GOOD_BODY = `<header><nav><a href="/">Home</a></nav></header>
<main><h1>Welcome</h1><h2>Section</h2><p>Text</p></main>
<footer><p>Footer</p></footer>`;

function get(checks: StructureCheck[], id: string): StructureCheck {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

describe("analyzeStructure — a clean page", () => {
  it("passes every check", () => {
    const report = analyzeStructure(page(GOOD_BODY));
    const notPassing = report.checks.filter((c) => c.status !== "pass").map((c) => `${c.id}: ${c.explanation}`);
    expect(notPassing).toEqual([]);
    expect(report.counts.fail).toBe(0);
    expect(report.scope).toBe("document");
  });
});

describe("headings", () => {
  it("flags missing and multiple h1", () => {
    expect(get(analyzeStructure(page("<main><h2>x</h2></main>")).checks, "h1").status).toBe("fail");
    const multi = get(analyzeStructure(page("<main><h1>a</h1><h1>b</h1></main>")).checks, "h1");
    expect(multi.status).toBe("warning");
    expect(multi.locations).toHaveLength(2);
  });

  it("builds an outline and flags skipped levels, empty headings and extra h1", () => {
    const report = analyzeStructure(page('<main><h1>Title</h1><h3>Skip</h3><h2></h2><h4><img src="x.png" alt="Logo"></h4><h1>Again</h1></main>'));
    expect(report.outline.map((h) => [h.level, h.text, h.issues])).toEqual([
      [1, "Title", []],
      [3, "Skip", ["skipped-level"]],
      [2, "", ["empty"]],
      [4, "Logo", ["skipped-level"]],
      [1, "Again", ["extra-h1"]],
    ]);
    expect(report.outline[1].previousLevel).toBe(1);
    expect(report.outline[0].line).toBe(11);
    const order = get(report.checks, "heading-order");
    expect(order.status).toBe("warning");
    expect(order.details?.[0]).toMatch(/h1 → h3: “Skip”/);
  });
});

describe("landmarks", () => {
  it("fails without main, warns for other missing landmarks, accepts roles", () => {
    expect(get(analyzeStructure(page("<h1>x</h1>")).checks, "landmarks").status).toBe("fail");
    const partial = get(analyzeStructure(page("<main><h1>x</h1></main>")).checks, "landmarks");
    expect(partial.status).toBe("warning");
    expect(partial.explanation).toMatch(/<header>, <nav>, <footer>/);
    const roles = analyzeStructure(page('<div role="banner"></div><div role="navigation"><a href="/">a</a></div><div role="main"><h1>x</h1></div><div role="contentinfo"></div>'));
    expect(get(roles.checks, "landmarks").status).toBe("pass");
  });
});

describe("lang", () => {
  it("validates <html lang>", () => {
    expect(get(analyzeStructure(page(GOOD_BODY, { htmlAttrs: "" })).checks, "html-lang").status).toBe("fail");
    expect(get(analyzeStructure(page(GOOD_BODY, { htmlAttrs: 'lang=""' })).checks, "html-lang").status).toBe("fail");
    expect(get(analyzeStructure(page(GOOD_BODY, { htmlAttrs: 'lang="en_US"' })).checks, "html-lang").explanation).toMatch(/not a valid BCP 47/);
    expect(get(analyzeStructure(page(GOOD_BODY, { htmlAttrs: 'lang="en-GB"' })).checks, "html-lang").status).toBe("pass");
    expect(get(analyzeStructure(page(GOOD_BODY, { htmlAttrs: 'lang="en" dir="left"' })).checks, "html-lang").status).toBe("warning");
  });
});

describe("right-to-left content", () => {
  const ARABIC = "<main><h1>مرحبا بكم في موقعنا</h1><p>هذا نص عربي طويل بما يكفي لاختبار اتجاه الصفحة من اليمين إلى اليسار.</p></main>";
  const URDU = "<main><h1>خوش آمدید</h1><p>یہ اردو زبان میں ایک طویل جملہ ہے تاکہ صفحے کی سمت کو جانچا جا سکے۔</p></main>";
  const HEBREW = "<main><h1>ברוכים הבאים</h1><p>זהו טקסט בעברית שנועד לבדוק את כיוון הדף מימין לשמאל.</p></main>";

  it.each([
    ["Arabic", ARABIC, "ar"],
    ["Urdu", URDU, "ur"],
    ["Hebrew", HEBREW, "he"],
  ])("passes %s with matching lang and dir=rtl", (_n, body, lang) => {
    expect(get(analyzeStructure(page(body, { htmlAttrs: `lang="${lang}" dir="rtl"` })).checks, "rtl").status).toBe("pass");
  });

  it("fails an Arabic page with no dir", () => {
    const c = get(analyzeStructure(page(ARABIC, { htmlAttrs: 'lang="ar"' })).checks, "rtl");
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/dir is missing \(should be “rtl”\)/);
  });

  it("fails an Arabic page with dir=ltr and wrong lang", () => {
    const c = get(analyzeStructure(page(ARABIC, { htmlAttrs: 'lang="en" dir="ltr"' })).checks, "rtl");
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/dir is “ltr”.*and lang is “en”/);
  });

  it("warns when dir=rtl is right but lang is missing", () => {
    expect(get(analyzeStructure(page(ARABIC, { htmlAttrs: 'dir="rtl"' })).checks, "rtl").status).toBe("warning");
  });

  it("warns on dir=rtl pages with no RTL text", () => {
    const c = get(analyzeStructure(page(GOOD_BODY, { htmlAttrs: 'lang="ar" dir="rtl"' })).checks, "rtl");
    expect(c.status).toBe("warning");
    expect(c.explanation).toMatch(/no right-to-left text/);
  });

  it("handles mixed content: warns unless RTL passages are marked", () => {
    const english = "<p>" + "This is a long English paragraph about the product. ".repeat(4) + "</p>";
    const quote = "<p>مرحبا بكم في موقعنا هذا نص عربي قصير</p>";
    expect(get(analyzeStructure(page(`<main><h1>x</h1>${english}${quote}</main>`)).checks, "rtl").status).toBe("warning");
    const marked = quote.replace("<p>", '<p lang="ar" dir="rtl">');
    expect(get(analyzeStructure(page(`<main><h1>x</h1>${english}${marked}</main>`)).checks, "rtl").status).toBe("pass");
  });

  it("passes plain LTR pages", () => {
    expect(get(analyzeStructure(page(GOOD_BODY)).checks, "rtl").status).toBe("pass");
  });

  it("detects scripts and RTL language tags", () => {
    expect(scriptStats("abc مرحبا").rtlLetters).toBe(5);
    expect(isRtlLanguage("ar-EG")).toBe(true);
    expect(isRtlLanguage("ur")).toBe(true);
    expect(isRtlLanguage("fa-IR")).toBe(true);
    expect(isRtlLanguage("ku-Arab")).toBe(true);
    expect(isRtlLanguage("az-Arab")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("sd-Latn")).toBe(false);
    expect(isValidLanguageTag("zh-Hant-TW")).toBe(true);
    expect(isValidLanguageTag("en_US")).toBe(false);
  });
});

describe("head checks", () => {
  it("checks the title", () => {
    expect(get(analyzeStructure("<!DOCTYPE html><html lang=en><head></head><body></body></html>").checks, "title").status).toBe("fail");
    expect(get(analyzeStructure(page(GOOD_BODY).replace("A good test page title", "")).checks, "title").status).toBe("fail");
    expect(get(analyzeStructure(page(GOOD_BODY).replace("A good test page title", "Home")).checks, "title").status).toBe("warning");
    expect(get(analyzeStructure(page(GOOD_BODY).replace("A good test page title", "x".repeat(80))).checks, "title").status).toBe("warning");
  });

  it("checks meta description, viewport and charset", () => {
    const noMeta = "<!DOCTYPE html><html lang=en><head><title>A good test page title</title></head><body><main><h1>x</h1></main></body></html>";
    const r = analyzeStructure(noMeta);
    expect(get(r.checks, "meta-description").status).toBe("warning");
    expect(get(r.checks, "viewport").status).toBe("warning");
    expect(get(r.checks, "charset").status).toBe("fail");
    expect(get(analyzeStructure(noMeta, { httpCharset: "utf-8" }).checks, "charset").status).toBe("pass");

    const noZoom = page(GOOD_BODY).replace("width=device-width, initial-scale=1", "width=device-width, user-scalable=no");
    expect(get(analyzeStructure(noZoom).checks, "viewport").explanation).toMatch(/WCAG 1\.4\.4/);
    const latin1 = page(GOOD_BODY).replace('<meta charset="utf-8">', '<meta charset="iso-8859-1">');
    expect(get(analyzeStructure(latin1).checks, "charset").status).toBe("warning");
  });
});

describe("accessibility checks", () => {
  it("flags images without alt and suspicious alt", () => {
    const r = analyzeStructure(page('<main><h1>x</h1><img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="IMG_2041.jpg"><img src="d.png" alt="A dog" role="none"></main>'));
    expect(r.images.map((i) => i.status)).toEqual(["missing", "empty", "filename", "ok"]);
    expect(r.images[3].decorative).toBe(true);
    const c = get(r.checks, "img-alt");
    expect(c.status).toBe("fail");
    expect(c.locations).toHaveLength(1);
  });

  it("flags links without an accessible name", () => {
    const r = analyzeStructure(
      page('<main><h1>x</h1><a href="/a"></a><a href="/b"><img src="i.png"></a><a href="/c"><img src="i.png" alt="Home"></a><a href="/d" aria-label="Close"></a><a href="/e"><svg><title>Search</title></svg></a><a name="anchor"></a></main>'),
    );
    const c = get(r.checks, "link-text");
    expect(c.status).toBe("fail");
    expect(c.affected).toBe(2);
  });

  it("flags buttons without an accessible name", () => {
    const r = analyzeStructure(
      page('<main><h1>x</h1><button></button><button aria-label="Menu"><svg></svg></button><button>Go</button><input type="submit"><input type="button"><div role="button"></div><input type="image" src="go.png"></main>'),
    );
    const c = get(r.checks, "button-name");
    expect(c.status).toBe("fail");
    expect(c.affected).toBe(4);
  });

  it("reports duplicate IDs with their lines", () => {
    const c = get(analyzeStructure(page('<main id="m"><h1 id="a">x</h1><p id="a">y</p><p id="b"></p><p id="b"></p></main>')).checks, "duplicate-ids");
    expect(c.status).toBe("fail");
    expect(c.details).toEqual(["“a” ×2 (lines 11, 11)", "“b” ×2 (lines 11, 11)"]);
  });

  it("counts inline styles and deprecated elements", () => {
    const r = analyzeStructure(page('<main><h1 style="color:red">x</h1><center><font color="red">old</font></center><marquee>hi</marquee><big>b</big></main>'));
    expect(get(r.checks, "inline-styles").explanation).toMatch(/^1 element uses a style attribute/);
    const dep = get(r.checks, "deprecated");
    expect(dep.status).toBe("fail");
    expect(dep.explanation).toMatch(/<center> ×1, <font> ×1, <marquee> ×1, <big> ×1/);
  });

  it("flags form fields without labels", () => {
    const r = analyzeStructure(
      page(`<main><h1>x</h1><form>
        <label for="name">Name</label><input id="name">
        <label>Email <input type="email"></label>
        <input aria-label="Search">
        <span id="lbl">Phone</span><input aria-labelledby="lbl">
        <input placeholder="Placeholder only">
        <select></select>
        <textarea title="Comments"></textarea>
        <input type="hidden"><input type="submit">
        <label for="ghost">Ghost</label><input id="other">
      </form></main>`),
    );
    const c = get(r.checks, "form-labels");
    expect(c.status).toBe("fail");
    expect(c.affected).toBe(3);
    expect(c.explanation).toMatch(/1 relies on a placeholder only/);
  });
});

describe("fragments", () => {
  it("skips document-level checks", () => {
    const r = analyzeStructure('<nav id="menu"><a href="/">Home</a></nav>\n<img src="logo.png">', { fragment: true });
    expect(r.scope).toBe("fragment");
    const ids = r.checks.map((c) => c.id);
    for (const skipped of ["h1", "landmarks", "html-lang", "rtl", "title", "meta-description", "viewport", "charset"]) expect(ids).not.toContain(skipped);
    expect(get(r.checks, "img-alt").locations?.[0].line).toBe(2);
    expect(get(r.checks, "heading-order").status).toBe("pass");
  });
});
