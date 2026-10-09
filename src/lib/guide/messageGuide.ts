/**
 * Plain-English explanations and example fixes for the most common Nu Html
 * Checker messages. Pattern → explanation → example fix. Unknown messages fall
 * back to the raw vnu text (matchGuide returns undefined).
 *
 * Patterns match vnu's exact wording, which uses curly quotes “…”. Capture
 * groups are substituted into {1}, {2}, … in the text fields.
 */

export interface GuideEntry {
  id: string;
  pattern: RegExp;
  /** Plain-English explanation of what is wrong and why it matters. */
  explanation: string;
  /** One-line instruction on how to fix it. */
  fix: string;
  /** Optional before/after code example. */
  example?: { before: string; after: string };
}

export interface GuideMatch {
  id: string;
  explanation: string;
  fix: string;
  example?: { before: string; after: string };
}

const Q = "[“\"]"; // opening quote
const E = "[”\"]"; // closing quote
const NAME = `${Q}([^”"]+)${E}`;

const r = (source: string, flags = "") => new RegExp(source, flags);

export const MESSAGE_GUIDE: GuideEntry[] = [
  /* ------------------------------------------------------------ document */
  {
    id: "doctype-missing",
    pattern: r(`^Start tag seen without seeing a doctype first\\. Expected ${Q}<!DOCTYPE html>${E}`),
    explanation: "The page doesn't start with a doctype, so browsers render it in quirks mode, with old, inconsistent layout rules.",
    fix: "Add <!DOCTYPE html> as the very first line.",
    example: { before: "<html lang=\"en\">", after: "<!DOCTYPE html>\n<html lang=\"en\">" },
  },
  {
    id: "doctype-obsolete",
    pattern: r(`^Obsolete doctype\\. Expected ${Q}<!DOCTYPE html>${E}`),
    explanation: "This is an HTML 4 / XHTML 1 doctype. Modern browsers only need the short HTML5 doctype, and validators check against HTML5.",
    fix: "Replace the long doctype with <!DOCTYPE html>.",
    example: { before: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "…">', after: "<!DOCTYPE html>" },
  },
  {
    id: "charset-undeclared",
    pattern: r("^The character encoding was not declared"),
    explanation: "Neither the server nor the page says which character encoding is used, so browsers guess, and accented or non-Latin text can turn into garbage.",
    fix: 'Add <meta charset="utf-8"> as the first element inside <head>, and save the file as UTF-8.',
    example: { before: "<head>\n  <title>…</title>", after: '<head>\n  <meta charset="utf-8">\n  <title>…</title>' },
  },
  {
    id: "charset-late",
    pattern: r("^(A charset attribute on a “meta” element found after the first 1024 bytes|The internal character encoding declaration specified)"),
    explanation: "The encoding declaration comes too late or disagrees with the actual encoding, so browsers may decode the page incorrectly.",
    fix: 'Put <meta charset="utf-8"> first in <head> and make sure the file and server use the same encoding.',
  },
  {
    id: "lang-missing",
    pattern: r(`^Consider adding a ${Q}lang${E} attribute to the ${Q}html${E} start tag`),
    explanation: "Without lang, screen readers may read the page in the wrong voice and browsers can't hyphenate or translate it correctly.",
    fix: "Add the page language to <html>, e.g. lang=\"en\" (or lang=\"ar\" dir=\"rtl\" for Arabic).",
    example: { before: "<html>", after: '<html lang="en">' },
  },
  {
    id: "title-missing",
    pattern: r(`^Element ${Q}head${E} is missing a required instance of child element ${Q}title${E}`),
    explanation: "Every page needs a <title>. It's shown in the browser tab, in search results and is the first thing screen readers announce.",
    fix: "Add a short, descriptive <title> inside <head>.",
    example: { before: "<head>\n  <meta charset=\"utf-8\">\n</head>", after: "<head>\n  <meta charset=\"utf-8\">\n  <title>Contact us – Acme</title>\n</head>" },
  },
  {
    id: "title-empty",
    pattern: r(`^Element ${Q}title${E} must not be empty`),
    explanation: "The <title> exists but has no text, so tabs, bookmarks and search results show nothing useful.",
    fix: "Write a descriptive title of roughly 10–60 characters.",
    example: { before: "<title></title>", after: "<title>Pricing – Acme</title>" },
  },
  {
    id: "x-ua-compatible",
    pattern: r(`${Q}X-UA-Compatible${E} must have a ${Q}content${E} attribute with the value ${Q}IE=edge${E}`),
    explanation: "This meta tag only affected old Internet Explorer. The only valid value is IE=edge; anything else (like chrome=1) is invalid.",
    fix: 'Remove the tag (IE is gone), or use exactly content="IE=edge".',
    example: { before: '<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">', after: "<!-- removed: not needed for modern browsers -->" },
  },
  {
    id: "eof-open-elements",
    pattern: r("^End of file (seen and there were open elements|reached when inside)"),
    explanation: "The document ended while some elements were still open, which usually means a missing closing tag earlier on.",
    fix: "Find the element that was never closed (often a <div>) and add its end tag.",
  },

  /* --------------------------------------------------- tags and nesting */
  {
    id: "stray-end-tag",
    pattern: r(`^Stray end tag ${NAME}`),
    explanation: "There's a closing </{1}> with no matching opening <{1}> still open at that point, usually an extra closing tag or a copy-paste leftover.",
    fix: "Remove the extra </{1}>, or add the missing <{1}> where it should start.",
    example: { before: "<div>\n  <p>Text</p>\n</div>\n</div>", after: "<div>\n  <p>Text</p>\n</div>" },
  },
  {
    id: "stray-start-tag",
    pattern: r(`^Stray start tag ${NAME}`),
    explanation: "A <{1}> start tag appears somewhere it can't be, for example after </html> or a second <body>.",
    fix: "Move the <{1}> element inside the right parent, or remove the duplicate.",
  },
  {
    id: "end-tag-open-elements",
    pattern: r(`^End tag ${NAME} seen, but there were open elements`),
    explanation: "</{1}> closes its element while elements inside it are still open, so the nesting is broken.",
    fix: "Close the inner elements before </{1}>. Check the lines just before it for a missing end tag.",
    example: { before: "<main>\n  <span>Text\n</main>", after: "<main>\n  <span>Text</span>\n</main>" },
  },
  {
    id: "unclosed-element",
    pattern: r(`^Unclosed element ${NAME}`),
    explanation: "This <{1}> is never closed, so the browser has to guess where it ends and everything after it may get the wrong styles.",
    fix: "Add </{1}> where the element should end.",
    example: { before: "<span>Unclosed text\n<p>Next paragraph</p>", after: "<span>Unclosed text</span>\n<p>Next paragraph</p>" },
  },
  {
    id: "not-allowed-as-child",
    pattern: r(`^Element ${NAME} not allowed as child of element ${NAME} in this context`),
    explanation: "HTML doesn't allow <{1}> directly inside <{2}>. Browsers will \"fix\" this differently, which can break layout and accessibility.",
    fix: "Move <{1}> to a valid parent, or change the parent/child elements (e.g. lists may only contain <li>).",
    example: { before: "<ul>\n  <p>Item</p>\n</ul>", after: "<ul>\n  <li>Item</li>\n</ul>" },
  },
  {
    id: "p-end-tag-no-p",
    pattern: r(`^No ${Q}p${E} element in scope but a ${Q}p${E} end tag seen`),
    explanation: "A </p> appears when no paragraph is open. Usually a block element such as <div> or <ul> was put inside a <p>, which automatically closes the paragraph early.",
    fix: "Don't put block elements inside <p>. Use a <div> as the wrapper, or close the paragraph first.",
    example: { before: "<p>Intro <div>Block</div> text</p>", after: "<div>Intro <div>Block</div> text</div>" },
  },
  {
    id: "same-element-open",
    pattern: r(`^Start tag ${NAME} seen but an element of the same type was already open`),
    explanation: "A <{1}> starts inside another <{1}>. Links (and some other elements) can't be nested.",
    fix: "Close the first <{1}> before starting the next one.",
    example: { before: '<a href="/one"><a href="/two">Two</a></a>', after: '<a href="/one">One</a> <a href="/two">Two</a>' },
  },
  {
    id: "descendant-not-allowed",
    pattern: r(`^The element ${NAME} must not appear as a descendant of the ${NAME} element`),
    explanation: "<{1}> isn't allowed anywhere inside <{2}>, for example interactive elements can't be nested in other interactive elements.",
    fix: "Restructure so <{1}> is outside <{2}>.",
    example: { before: '<button><a href="/x">Go</a></button>', after: '<a class="button" href="/x">Go</a>' },
  },
  {
    id: "text-not-allowed",
    pattern: r(`^Text not allowed in element ${NAME} in this context`),
    explanation: "<{1}> can only contain specific child elements, not loose text.",
    fix: "Wrap the text in the right child element (e.g. <li> inside <ul>, <td> inside <tr>).",
    example: { before: "<ul>Item</ul>", after: "<ul><li>Item</li></ul>" },
  },
  {
    id: "self-closing-non-void",
    pattern: r("^Self-closing syntax \\(“/>”\\) used on a non-void HTML element"),
    explanation: "In HTML, /> does not close elements like <div/> or <span/>. The browser treats it as an opening tag, so everything after becomes its content.",
    fix: "Write an explicit end tag: <div></div>.",
    example: { before: '<div class="spacer"/>', after: '<div class="spacer"></div>' },
  },
  {
    id: "trailing-slash-void",
    pattern: r("^Trailing slash on void elements has no effect"),
    explanation: "Void elements like <br>, <img> and <meta> never need a closing slash in HTML. It does nothing, and with unquoted attributes it can end up inside the value.",
    fix: "Drop the slash, or keep it consistently with quoted attribute values.",
    example: { before: "<br/>\n<img src=logo.png/>", after: '<br>\n<img src="logo.png" alt="…">' },
  },
  {
    id: "element-obsolete",
    pattern: r(`^The ${NAME} element is obsolete`),
    explanation: "<{1}> was removed from HTML. Browsers still render it for now, but it mixes presentation into markup and may stop working.",
    fix: "Replace <{1}> with a semantic element and CSS.",
    example: { before: "<center><font color=\"red\">Sale</font></center>", after: '<p class="notice">Sale</p>\n<style>.notice { text-align: center; color: red; }</style>' },
  },
  {
    id: "style-in-body",
    pattern: r(`^Element ${Q}style${E} not allowed as child of element ${Q}body${E}`),
    explanation: "<style> blocks belong in <head>. In <body> they can cause a flash of unstyled content.",
    fix: "Move the <style> element into <head>, or into an external stylesheet.",
  },

  /* --------------------------------------------------------- attributes */
  {
    id: "duplicate-id",
    pattern: r(`^Duplicate ID ${NAME}`),
    explanation: "id=\"{1}\" is used on more than one element. IDs must be unique: labels, in-page links, CSS and JavaScript will pick the wrong element.",
    fix: "Give each element its own id, or use a class for shared styling.",
    example: { before: '<nav id="{1}">…</nav>\n<div id="{1}">…</div>', after: '<nav id="{1}">…</nav>\n<div id="{1}-mobile">…</div>' },
  },
  {
    id: "first-occurrence-id",
    pattern: r(`^The first occurrence of ID ${NAME} was here`),
    explanation: "This is where id=\"{1}\" is first used. It's shown to help you find the duplicate reported next to it.",
    fix: "Keep this id and rename the later duplicates.",
  },
  {
    id: "duplicate-attribute",
    pattern: r(`^Duplicate attribute ${NAME}`),
    explanation: "The same element has {1}=\"…\" twice. Browsers keep the first one and silently ignore the rest.",
    fix: "Remove the duplicate {1} attribute, keeping the value you want.",
    example: { before: '<input id="q" id="search">', after: '<input id="search">' },
  },
  {
    id: "attribute-not-allowed",
    pattern: r(`^Attribute ${NAME} not allowed on element ${NAME} at this point`),
    explanation: "{1} isn't a valid attribute for <{2}>. It may be a typo, a framework-specific attribute, or something only an old browser understood.",
    fix: "Remove it, fix the spelling, or use a data-{1} attribute for custom data.",
    example: { before: '<div {1}="x">', after: '<div data-{1}="x">' },
  },
  {
    id: "missing-required-attribute",
    pattern: r(`^Element ${NAME} is missing (?:a )?required attribute ${NAME}`),
    explanation: "<{1}> must have the {2} attribute to work correctly.",
    fix: "Add the {2} attribute with a valid value.",
  },
  {
    id: "attribute-obsolete",
    pattern: r(`^The ${NAME} attribute on the ${NAME} element is obsolete`),
    explanation: "{1} on <{2}> is an old presentational attribute that HTML no longer supports.",
    fix: "Remove it and do the same with CSS (e.g. width, border, text-align, margin).",
    example: { before: '<table border="1" align="center">', after: '<table class="data">\n<style>.data { margin: 0 auto; border: 1px solid; }</style>' },
  },
  {
    id: "bad-value-empty",
    pattern: r(`^Bad value ${Q}${E} for attribute ${NAME} on element ${NAME}: Must be non-empty`),
    explanation: "{1} on <{2}> is present but empty, which isn't allowed.",
    fix: "Give {1} a value, or remove the attribute entirely.",
  },
  {
    id: "bad-value",
    pattern: r(`^Bad value ${Q}([^”"]*)${E} for attribute ${NAME} on element ${NAME}`),
    explanation: "“{1}” is not a valid value for the {2} attribute of <{3}>. The detail after the colon says what was expected.",
    fix: "Change {2} to a value of the right type: numbers without units for width/height, real URLs for href/src, true boolean attributes without values.",
    example: { before: '<img width="50%">  <input required="false">', after: '<img width="400">  <input> (omit the attribute to mean false)' },
  },
  {
    id: "form-action-omit",
    pattern: r(`^To set the document.s location as the action for a form, omit the ${Q}action${E} attribute`),
    explanation: "action=\"\" is invalid. A form without an action already submits to the current page.",
    fix: "Remove the action attribute, or set it to the real URL that handles the form.",
    example: { before: '<form action="">', after: "<form>" },
  },
  {
    id: "type-javascript-unnecessary",
    pattern: r(`^The ${Q}type${E} attribute is unnecessary for JavaScript resources`),
    explanation: "type=\"text/javascript\" is the default for <script>, so it's just noise.",
    fix: "Remove the type attribute (keep type=\"module\" where you use it).",
    example: { before: '<script src="app.js" type="text/javascript"></script>', after: '<script src="app.js"></script>' },
  },
  {
    id: "type-style-unnecessary",
    pattern: r(`^The ${Q}type${E} attribute for the ${Q}style${E} element is not needed`),
    explanation: "type=\"text/css\" is the default for <style>.",
    fix: "Remove the type attribute.",
    example: { before: '<style type="text/css">', after: "<style>" },
  },
  {
    id: "unnecessary-role",
    pattern: r(`^The ${NAME} role is unnecessary for element ${NAME}`),
    explanation: "<{2}> already has the {1} role built in, so role=\"{1}\" repeats it.",
    fix: "Remove the role attribute.",
    example: { before: '<{2} role="{1}">', after: "<{2}>" },
  },
  {
    id: "aria-label-misuse",
    pattern: r(`^Possible misuse of ${Q}aria-label${E}`),
    explanation: "aria-label is only reliably announced on interactive elements, landmarks and some roles. On a plain <div> or <span> screen readers usually ignore it.",
    fix: "Put the text in the content, use it on an element with a suitable role, or use a visually hidden text span.",
  },
  {
    id: "img-alt-missing",
    pattern: r(`^An ${Q}img${E} element must have an ${Q}alt${E} attribute`),
    explanation: "Screen readers can't describe this image, and it's skipped by search engines. Every <img> needs alt text — or an empty alt=\"\" if it's purely decorative.",
    fix: "Describe what the image shows or does; use alt=\"\" for decorative images.",
    example: { before: '<img src="logo.png">', after: '<img src="logo.png" alt="Acme home">' },
  },
  {
    id: "label-for-invalid",
    pattern: r(`${Q}for${E} attribute of the ${Q}label${E} element must (be the ID of|refer to) a non-hidden form control`),
    explanation: "This <label for=\"…\"> points at an id that doesn't exist (or isn't a form field), so clicking the label does nothing and screen readers don't connect it.",
    fix: "Make for=\"…\" match the id of the input it labels.",
    example: { before: '<label for="email">Email</label>\n<input id="mail">', after: '<label for="email">Email</label>\n<input id="email">' },
  },

  /* ------------------------------------------------------------ headings */
  {
    id: "heading-skip",
    pattern: r(`^The heading ${Q}h(\\d)${E}.*follows the heading ${Q}h(\\d)${E}`),
    explanation: "An <h{1}> comes right after an <h{2}>, skipping levels. Screen-reader users navigate by heading level and may think content is missing.",
    fix: "Use the next level down (one more than the previous heading), and style it with CSS if it should look smaller.",
    example: { before: "<h1>Title</h1>\n<h3>Section</h3>", after: "<h1>Title</h1>\n<h2>Section</h2>" },
  },
  {
    id: "section-lacks-heading",
    pattern: r("^(Section|Article) lacks heading"),
    explanation: "<section> and <article> are meant for content with its own heading. Without one, the outline has an unnamed part.",
    fix: "Add a heading (h2–h6) at the start, or use a <div> if it's only a styling wrapper.",
    example: { before: '<section class="promo">…</section>', after: '<section class="promo">\n  <h2>Spring sale</h2>…\n</section>' },
  },
  {
    id: "h1-top-level",
    pattern: r(`^Consider using the ${Q}h1${E} element as a top-level heading only`),
    explanation: "There's an <h1> inside a section. Browsers treat every <h1> as top-level, so the page appears to have several main headings.",
    fix: "Use <h2>–<h6> inside sections and keep a single <h1> for the page.",
  },

  /* ------------------------------------------------------- text & syntax */
  {
    id: "unescaped-ampersand",
    pattern: r("^(& did not start a character reference|Named character reference was not terminated by a semicolon)"),
    explanation: "A bare “&” in text or a URL is read as the start of an entity like &amp;. It usually works by accident but can corrupt query strings.",
    fix: "Write & as &amp; (including inside href values).",
    example: { before: '<a href="/search?q=a&page=2">', after: '<a href="/search?q=a&amp;page=2">' },
  },
  {
    id: "bad-char-after-lt",
    pattern: r("^Bad character .* after “<”"),
    explanation: "A “<” in text was read as the start of a tag.",
    fix: "Write a literal < as &lt;.",
    example: { before: "<p>if a < b</p>", after: "<p>if a &lt; b</p>" },
  },
  {
    id: "attribute-syntax",
    pattern: r("^(Saw “<” when expecting an attribute name|Quote “\"” in attribute name|Saw “=” when expecting an attribute name|No space between attributes)"),
    explanation: "An attribute is malformed, usually a missing closing quote, a missing “>” or no space between two attributes.",
    fix: "Check the quotes and spacing in this tag; every attribute value should be name=\"value\" with a space before the next one.",
    example: { before: '<a href="/x"class="btn>Go</a>', after: '<a href="/x" class="btn">Go</a>' },
  },

  /* ------------------------------------------------------------------ CSS */
  {
    id: "css-unknown-property",
    pattern: r(`(?:^CSS: )?${NAME}: Property ${NAME} doesn't exist`),
    explanation: "“{1}” isn't a CSS property, usually a typo. Browsers ignore the whole declaration.",
    fix: "Correct the property name (check spelling), or remove it.",
    example: { before: "body { colr: #333; }", after: "body { color: #333; }" },
  },
  {
    id: "css-too-many-values",
    pattern: r(`(?:^CSS: )?${NAME}: Too many values or values are not recognized`),
    explanation: "The value given for {1} has too many parts or a part the property doesn't accept. Browsers drop the declaration.",
    fix: "Use the value syntax {1} expects (e.g. margin takes 1–4 lengths; width takes one).",
    example: { before: ".box { width: 10px 20px; }", after: ".box { width: 10px; }" },
  },
  {
    id: "css-invalid-color",
    pattern: r(`(?:^CSS: )?${NAME}: ${NAME} is not a (valid color|${Q}color${E} value)`),
    explanation: "“{2}” isn't a valid colour, so {1} is ignored.",
    fix: "Use a valid hex (#333, #336699), rgb()/hsl() value or a colour keyword.",
    example: { before: "color: #ggg;", after: "color: #666;" },
  },
  {
    id: "css-invalid-value",
    pattern: r(`(?:^CSS: )?${NAME}: ${NAME} is not a ${NAME} value`),
    explanation: "“{2}” isn't a valid value for {1}, so the browser ignores the declaration.",
    fix: "Use one of the values {1} accepts.",
    example: { before: "font-weight: heavy;", after: "font-weight: 700;" },
  },
  {
    id: "css-parse-error",
    pattern: r("(?:^CSS: )?Parse Error"),
    explanation: "The CSS couldn't be parsed at this point, often a missing semicolon, an unclosed brace or a stray character. Everything until the next valid rule may be ignored.",
    fix: "Check the line for a missing “;” or “}”, or a typo before it.",
    example: { before: "a { color: red\n  margin: 0 }", after: "a { color: red;\n  margin: 0; }" },
  },
  {
    id: "css-unknown-at-rule",
    pattern: r("(?:^CSS: )?Unrecognized at-rule"),
    explanation: "This @-rule isn't known to the CSS checker. It may be a typo or a new/vendor-specific rule.",
    fix: "Check the spelling; if it's intentional and supported by your target browsers you can hide this message with a filter.",
  },
];

function fill(text: string, groups: string[]): string {
  return text.replace(/\{(\d)\}/g, (_, i: string) => groups[Number(i) - 1] ?? "");
}

/** Find the guide entry for a vnu message, with captured names substituted. */
export function matchGuide(message: string): GuideMatch | undefined {
  // Most specific first: "bad-value-empty" must win over "bad-value", "css-invalid-color" over "css-invalid-value".
  for (const entry of MESSAGE_GUIDE) {
    const m = entry.pattern.exec(message);
    if (!m) continue;
    const groups = m.slice(1).filter((g): g is string => g !== undefined);
    return {
      id: entry.id,
      explanation: fill(entry.explanation, groups),
      fix: fill(entry.fix, groups),
      example: entry.example && { before: fill(entry.example.before, groups), after: fill(entry.example.after, groups) },
    };
  }
  return undefined;
}
