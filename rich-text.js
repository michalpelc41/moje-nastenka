import "./vendor/quill.js";
import DOMPurify from "./vendor/purify.es.mjs";

const Quill = window.Quill;
const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "h2", "blockquote", "ul", "ol", "li", "a"];

export function safeURL(value, addProtocol = false) {
  let text = String(value ?? "").trim();
  if (!text || /[\u0000-\u0020\u007f]/.test(text)) return null;
  if (addProtocol && !/^[a-z][a-z\d+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName !== "A") return;
  const href = safeURL(node.getAttribute("href"));
  if (!href) { node.removeAttribute("href"); return; }
  node.setAttribute("href", href);
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
});

export function sanitizeHTML(html, fragment = false) {
  return DOMPurify.sanitize(String(html), {
    ALLOWED_TAGS, ALLOWED_ATTR: ["href"], ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: fragment
  });
}

export function renderNoteContent(node, note) {
  const rich = note.content_format === "html";
  node.classList.toggle("rich-text", rich);
  node.classList.toggle("plain-text", !rich);
  if (rich) node.replaceChildren(sanitizeHTML(note.content, true));
  else node.textContent = note.content;
}

const BaseLink = Quill.import("formats/link");
class SafeLink extends BaseLink {
  static sanitize(value) { return safeURL(value) || "about:blank"; }
}
Quill.register(SafeLink, true);

export function createNoteEditor(onChange) {
  const $ = id => document.getElementById(id);
  const quill = new Quill($("note-content"), {
    theme: "snow", placeholder: "Co máte na mysli?",
    formats: ["bold", "italic", "underline", "header", "list", "blockquote", "link"],
    modules: { toolbar: "#format-toolbar", history: { userOnly: true } }
  });
  quill.root.setAttribute("role", "textbox");
  quill.root.setAttribute("aria-multiline", "true");
  quill.root.setAttribute("aria-labelledby", "content-label");
  quill.root.setAttribute("aria-describedby", "char-count");
  quill.root.setAttribute("aria-required", "true");
  quill.root.setAttribute("spellcheck", "true");
  $("insert-link").setAttribute("aria-controls", "link-panel");
  $("insert-link").setAttribute("aria-expanded", "false");
  let linkRange = null;

  function closeLink(focus = true) {
    $("link-panel").hidden = true;
    $("insert-link").setAttribute("aria-expanded", "false");
    $("link-url").value = "";
    if (focus) {
      quill.focus();
      if (linkRange) quill.setSelection(linkRange, "silent");
    }
    linkRange = null;
  }

  function openLink() {
    linkRange = quill.getSelection(true) || { index: quill.getLength() - 1, length: 0 };
    const format = quill.getFormat(linkRange);
    // Při umístění kurzoru do odkazu upravujeme celý odkaz.
    if (!linkRange.length && format.link) {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const anchor = (node?.nodeType === 1 ? node : node?.parentElement)?.closest("a");
      if (anchor && quill.root.contains(anchor)) {
        const blot = Quill.find(anchor);
        if (blot) linkRange = { index: quill.getIndex(blot), length: anchor.textContent.length };
      }
    }
    $("link-url").value = typeof format.link === "string" ? format.link : "";
    $("remove-link").hidden = !format.link;
    $("link-error").hidden = true;
    $("link-panel").hidden = false;
    $("insert-link").setAttribute("aria-expanded", "true");
    $("link-url").focus();
  }

  function applyLink() {
    const url = safeURL($("link-url").value, true);
    if (!url || url.length > 2048) {
      $("link-error").textContent = "Zadejte platnou adresu webu (https:// nebo http://), bez přihlašovacích údajů.";
      $("link-error").hidden = false;
      $("link-url").focus();
      return;
    }
    const range = linkRange || { index: quill.getLength() - 1, length: 0 };
    quill.focus();
    if (range.length) quill.formatText(range.index, range.length, "link", url, "user");
    else {
      quill.insertText(range.index, url, { link: url }, "user");
      quill.setSelection(range.index + url.length, 0, "silent");
      quill.format("link", false, "silent");
    }
    closeLink(false);
    onChange();
  }

  $("insert-link").addEventListener("click", openLink);
  $("apply-link").addEventListener("click", applyLink);
  $("cancel-link").addEventListener("click", () => closeLink());
  $("remove-link").addEventListener("click", () => {
    if (linkRange) quill.formatText(linkRange.index, linkRange.length, "link", false, "user");
    closeLink();
  });
  $("link-url").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); applyLink(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeLink(); }
  });
  quill.on("text-change", onChange);
  quill.on("editor-change", () => {
    for (const button of $("format-toolbar").querySelectorAll("button:not(#insert-link)")) {
      button.setAttribute("aria-pressed", String(button.classList.contains("ql-active")));
    }
  });
  return {
    setNote(note) {
      closeLink(false);
      if (note?.content_format === "html") quill.setContents(quill.clipboard.convert({ html: sanitizeHTML(note.content) }), "silent");
      else quill.setText(note?.content ?? "", "silent");
      quill.history.clear();
      onChange();
    },
    clear() { quill.setText("", "silent"); quill.history.clear(); closeLink(false); },
    focus() { quill.focus(); },
    text() { return quill.getText().replace(/\n$/, ""); },
    html() { return sanitizeHTML(quill.getSemanticHTML()); },
    enable(enabled) { quill.enable(enabled); quill.root.setAttribute("aria-disabled", String(!enabled)); },
    isLinkOpen() { return !$("link-panel").hidden; },
    closeLink,
    // Vyhledávání používá viditelný text, nikoli HTML značky.
    plainText(html) {
      const container = document.createElement("div");
      container.append(sanitizeHTML(html, true));
      for (const block of container.querySelectorAll("p,h2,li,blockquote,br")) block.append(document.createTextNode("\n"));
      return container.textContent.replace(/\u00a0/g, " ");
    }
  };
}
