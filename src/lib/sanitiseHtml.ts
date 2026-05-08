/**
 * Allowlist-based HTML sanitiser to prevent XSS.
 *
 * Strips all elements not in the allowed set, removes dangerous attributes
 * (event handlers, javascript: URIs), and blocks vectors like <iframe>,
 * <svg onload>, <img onerror>, <object>, <embed>, <style>, etc.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "b",
  "i",
  "u",
  "em",
  "strong",
  "a",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "span",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "sub",
  "sup",
  "small",
  "del",
  "ins",
  "mark",
  "abbr",
  "img",
]);

/** Attributes that are always safe regardless of tag. */
const ALLOWED_ATTRS = new Set(["class", "id", "style", "title", "dir", "lang"]);

/** Tag-specific attribute allowlists. */
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
};

const DANGEROUS_URI_RE = /^\s*(javascript|vbscript|data)\s*:/i;

function isSafeUri(value: string): boolean {
  return !DANGEROUS_URI_RE.test(value);
}

/**
 * Strips HTML to only allowed tags and attributes.
 * Handles self-closing tags, attributes with and without quotes,
 * event handlers, and dangerous URI schemes.
 */
export function sanitiseHtml(dirty: string): string {
  // Step 1: Remove full blocks that are never safe
  let html = dirty
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe[\s\S]*?\/?>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?\/?>/gi, "")
    .replace(/<form[\s\S]*?>[\s\S]*?<\/form>/gi, "")
    .replace(/<textarea[\s\S]*?>[\s\S]*?<\/textarea>/gi, "")
    .replace(/<select[\s\S]*?>[\s\S]*?<\/select>/gi, "")
    .replace(/<input[\s\S]*?\/?>/gi, "")
    .replace(/<button[\s\S]*?>[\s\S]*?<\/button>/gi, "")
    .replace(/<meta[\s\S]*?\/?>/gi, "")
    .replace(/<link[\s\S]*?\/?>/gi, "")
    .replace(/<base[\s\S]*?\/?>/gi, "");

  // Step 2: Process remaining tags — strip disallowed tags, filter attributes
  html = html.replace(
    /<\/?([a-z][a-z0-9]*)\b([^>]*)?\/?>/gi,
    (match, tagName: string, attrString: string | undefined) => {
      const tag = tagName.toLowerCase();

      if (!ALLOWED_TAGS.has(tag)) {
        return "";
      }

      // Closing tags need no attributes
      if (match.startsWith("</")) {
        return `</${tag}>`;
      }

      const isSelfClosing = match.trimEnd().endsWith("/>");
      const safeAttrs: string[] = [];
      const tagSpecific = TAG_ATTRS[tag];

      if (attrString) {
        // Match attributes: name="value", name='value', name=value, name (boolean)
        const attrRegex =
          /([a-z][a-z0-9_-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>'"]+)))?/gi;
        let attrMatch: RegExpExecArray | null;

        while ((attrMatch = attrRegex.exec(attrString)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";

          // Block all event handlers
          if (attrName.startsWith("on")) {
            continue;
          }

          // Only allow explicitly permitted attributes
          if (!ALLOWED_ATTRS.has(attrName) && !tagSpecific?.has(attrName)) {
            continue;
          }

          // Block dangerous URI values on href/src
          if (
            (attrName === "href" || attrName === "src") &&
            !isSafeUri(attrValue)
          ) {
            continue;
          }

          safeAttrs.push(`${attrName}="${attrValue.replace(/"/g, "&quot;")}"`);
        }
      }

      // Force rel="noopener noreferrer" on links with target
      if (tag === "a") {
        const hasTarget = safeAttrs.some((a) => a.startsWith("target="));
        if (hasTarget && !safeAttrs.some((a) => a.startsWith("rel="))) {
          safeAttrs.push('rel="noopener noreferrer"');
        }
      }

      const attrs = safeAttrs.length > 0 ? " " + safeAttrs.join(" ") : "";
      return isSelfClosing ? `<${tag}${attrs} />` : `<${tag}${attrs}>`;
    },
  );

  return html;
}
