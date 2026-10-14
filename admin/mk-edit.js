/* Gemeinsamer Editor-Kern für /admin (Betreiber) und /<slug>/admin (Kunde):
   HTML-Modell, Vorschau, Klick-Auswahl, Sektionen, Bilder, Übersetzungen. */
(function () {
  "use strict";

  var INLINE = { B: 1, I: 1, EM: 1, STRONG: 1, BR: 1, SPAN: 1, SMALL: 1, A: 1, U: 1, SUP: 1, SUB: 1, MARK: 1, S: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, LINK: 1, META: 1, svg: 1, SVG: 1 };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.append(x); }); else el.append(c);
    }
    return el;
  }

  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
  // Im Editor „&“ statt „&amp;“ zeigen; beim Speichern wieder korrekt kodieren.
  function toEditable(html) { return String(html).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"); }
  function fromEditable(v) { return String(v).replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, "&amp;").replace(/ /g, "&nbsp;"); }
  function slugify(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "bild";
  }

  // ------------------------------------------------------------ Seite
  /** Neues Seitenmodell aus dem HTML vom Server. */
  function loadPage(id, j) {
    var p = { id: id, htmlSha: j.htmlSha, overridesSha: j.overridesSha, uploads: [] };
    p.doctype = (j.html.match(/^\s*<!doctype[^>]*>/i) || ["<!doctype html>"])[0].trim();
    p.doc = new DOMParser().parseFromString(j.html, "text/html");
    p.base = serialize(p);
    p.overrides = j.overrides || {};
    p.overridesBase = JSON.stringify(p.overrides);
    return p;
  }
  function serialize(p) { return p.doctype + "\n" + p.doc.documentElement.outerHTML + "\n"; }
  function pageDirty(p) { return !!p.doc && (serialize(p) !== p.base || JSON.stringify(p.overrides) !== p.overridesBase || p.uploads.length > 0); }

  /** Sektionen: alles in <main> ist verschiebbar, Rest (Header, Footer …) fix. */
  function blockList(doc) {
    var out = [];
    Array.prototype.forEach.call(doc.body.children, function (el) {
      if (SKIP[el.tagName]) return;
      if (el.tagName === "MAIN") {
        Array.prototype.forEach.call(el.children, function (c) { if (!SKIP[c.tagName]) out.push({ el: c, movable: true }); });
      } else out.push({ el: el, movable: false });
    });
    return out;
  }
  function blockName(el, L) {
    var cl = el.classList, id = el.id;
    if (el.tagName === "HEADER") return [L.header, "header"];
    if (el.tagName === "FOOTER") return [L.footer, "footer"];
    if (cl.contains("mobile-bar")) return [L.mobileBar, ".mobile-bar"];
    if (cl.contains("ld")) return [L.loader, ".ld"];
    if (cl.contains("progress")) return [L.progress, ".progress"];
    if (cl.contains("lb") || el.getAttribute("role") === "dialog") return [L.lightbox, "#" + (id || "lb")];
    if (cl.contains("hero")) return [L.hero, ".hero"];
    var t = el.querySelector("h1,h2,h3");
    var txt = t ? t.textContent.replace(/\s+/g, " ").trim() : "";
    if (txt.length > 48) txt = txt.slice(0, 46) + "…";
    if (!txt) { var img = el.querySelector("img[alt]"); txt = img ? img.getAttribute("alt") : ""; }
    return [txt || L.section || "Abschnitt", id ? "#" + id : el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "")];
  }

  /** Ausgeblendete Elemente (data-mk-off) per CSS verstecken, inkl. Menülinks dorthin. */
  function updateMkStyle(doc) {
    var ids = [];
    Array.prototype.forEach.call(doc.querySelectorAll("[data-mk-off][id]"), function (el) { if (/^[\w-]+$/.test(el.id)) ids.push(el.id); });
    var any = doc.querySelector("[data-mk-off]");
    var css = any ? "[data-mk-off]{display:none!important}" + (ids.length ? ids.map(function (i) { return "header a[href=\"#" + i + "\"],footer a[href=\"#" + i + "\"],nav a[href=\"#" + i + "\"]"; }).join(",") + "{display:none!important}" : "") : "";
    var st = doc.getElementById("mk-admin-style");
    if (!css) { if (st) st.remove(); return ""; }
    if (!st) { st = doc.createElement("style"); st.id = "mk-admin-style"; doc.head.appendChild(st); }
    st.textContent = css;
    return css;
  }

  function overridesJs(o) {
    return "(function(o){var I=window.I18N=window.I18N||{};for(var l in o){I[l]=Object.assign(I[l]||{},o[l]);}})(" + JSON.stringify(o).replace(/</g, "\\u003c") + ");";
  }
  function ensureOverridesTag(doc) {
    if (doc.querySelector('script[src="mk-i18n.js"]')) return;
    var i18n = Array.prototype.find.call(doc.querySelectorAll("script[src]"), function (s) { return /(^|\/)i18n\.js$/.test(s.getAttribute("src")); });
    if (!i18n) return;
    var s = doc.createElement("script");
    s.setAttribute("src", "mk-i18n.js");
    if (i18n.hasAttribute("defer")) s.setAttribute("defer", "");
    i18n.after(s);
    i18n.after(doc.createTextNode("\n"));
  }

  /**
   * Vorschau-HTML (srcdoc): jedes Element bekommt data-mk=<index>, damit Klicks
   * auf das Modell zurückgeführt werden können. Setzt p.idx / p.els.
   */
  function previewHtml(p, baseHref, pending) {
    var c = p.doc.cloneNode(true);
    var a = p.doc.getElementsByTagName("*"), b = c.getElementsByTagName("*");
    p.idx = new Map(); p.els = [];
    for (var i = 0; i < a.length; i++) { b[i].setAttribute("data-mk", i); p.idx.set(a[i], i); p.els[i] = a[i]; }
    var base = c.createElement("base");
    base.setAttribute("href", baseHref);
    c.head.insertBefore(base, c.head.firstChild);
    // Lade-Animationen (z. B. Lovekino) warten auf alle Bilder und verdecken die
    // Vorschau sekundenlang – im Editor sofort aus.
    c.documentElement.classList.add("ld-gone");
    var noLd = c.createElement("style");
    noLd.textContent = ".ld{display:none!important}";
    c.head.appendChild(noLd);
    var ov = c.querySelector('script[src="mk-i18n.js"]');
    if (ov) ov.setAttribute("src", "data:text/javascript;charset=utf-8," + encodeURIComponent(overridesJs(p.overrides)));
    // Relative Pfade direkt absolut machen (der Preload-Scanner ignoriert <base> in srcdoc)
    var abs = function (u) { return /^([a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(u) ? u : baseHref + u; };
    Array.prototype.forEach.call(c.querySelectorAll("[src],link[href],[srcset],[imagesrcset]"), function (x) {
      if (x.hasAttribute("src")) x.setAttribute("src", abs(x.getAttribute("src")));
      if (x.tagName === "LINK") x.setAttribute("href", abs(x.getAttribute("href")));
      ["srcset", "imagesrcset"].forEach(function (at) {
        if (x.hasAttribute(at)) x.setAttribute(at, x.getAttribute(at).split(",").map(function (part) { var t = part.trim(); return t ? abs(t) : t; }).join(", "));
      });
    });
    // Neue Bilder sind erst nach dem Deploy online – bis dahin aus dem Speicher zeigen.
    var pend = Object.assign({}, pending || {});
    p.uploads.forEach(function (u) { pend[u.path] = u.dataUrl; });
    Array.prototype.forEach.call(c.querySelectorAll("img[src]"), function (img) { var u = pend[img.getAttribute("src").replace(baseHref, "")]; if (u) img.setAttribute("src", u); });
    return "<!doctype html>\n" + c.documentElement.outerHTML;
  }

  /**
   * Vorschau laden und onReady aufrufen, sobald das HTML da ist – nicht erst nach
   * allen Bildern (onload), sonst ist auf dem Handy sekundenlang nichts antippbar.
   */
  var frameSeq = 0;
  function loadFrame(frame, html, onReady) {
    var seq = String(++frameSeq), done = false, tries = 0;
    function ready() {
      if (done || seq !== String(frameSeq)) return;
      var d; try { d = frame.contentDocument; } catch (e) { d = null; }
      if (!d || !d.documentElement || d.documentElement.getAttribute("data-mk-seq") !== seq || d.readyState === "loading") return;
      done = true; onReady();
    }
    frame.onload = ready;
    frame.srcdoc = html.replace(/<html\b/i, '<html data-mk-seq="' + seq + '"');
    (function poll() { ready(); if (!done && seq === String(frameSeq) && ++tries < 400) setTimeout(poll, 50); })();
  }

  /** Scrollposition nach dem Neuladen wiederherstellen – auch wenn Bilder später die Höhe ändern. */
  function restoreScroll(frame, y) {
    var w = frame.contentWindow, d = frame.contentDocument, stop = false;
    var go = function () { if (!stop) try { w.scrollTo(0, y); } catch (e) {} };
    ["touchstart", "wheel", "keydown"].forEach(function (ev) { d.addEventListener(ev, function () { stop = true; }, { passive: true, capture: true }); });
    go(); setTimeout(go, 60);
    w.addEventListener("load", go);
  }

  function isTexty(el) {
    if (/^(SCRIPT|STYLE|IMG|svg|SVG|INPUT|SELECT|TEXTAREA|IFRAME|VIDEO)$/.test(el.tagName)) return false;
    if (!el.textContent.trim()) return false;
    return Array.prototype.every.call(el.querySelectorAll("*"), function (c) { return INLINE[c.tagName]; });
  }

  /** Ist das Element im Vorschau-Fenster wirklich zu sehen? (Überblendungen, Karussells …) */
  function shown(x) {
    var w = x.ownerDocument.defaultView, op = 1;
    for (var n = x; n && n.nodeType === 1; n = n.parentElement) {
      var cs = w.getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      op *= parseFloat(cs.opacity);
      if (op < 0.08) return false;
    }
    return true;
  }

  // Liegt über einem Bild/Text eine Deko-Ebene oder ein unsichtbares Bild (Überblendung),
  // wird das sichtbare Bild bzw. der sichtbare Text darunter gewählt.
  function pickTarget(d, e, p) {
    var top = e.target.closest && e.target.closest("[data-mk]");
    if (!top) return null;
    var useful = function (el) { return el && (el.tagName === "IMG" || el.tagName === "A" || el.getAttribute("data-i18n") || el.getAttribute("data-i18n-html") || isTexty(el)); };
    var topEl = p.els[Number(top.getAttribute("data-mk"))];
    if (useful(topEl) && shown(top)) return top;
    var stack = d.elementsFromPoint(e.clientX, e.clientY);
    for (var i = 0; i < stack.length; i++) {
      var x = stack[i];
      if (!x.hasAttribute || !x.hasAttribute("data-mk") || !shown(x)) continue;
      var src = p.els[Number(x.getAttribute("data-mk"))];
      if (src && (src.tagName === "IMG" || isTexty(src))) return x;
    }
    return shown(top) ? top : null;
  }

  // Kommentar direkt vor einer Sektion (z. B. <!-- ===== FAQ ===== -->) gehört zu ihr.
  function leadComment(el) {
    var n = el.previousSibling;
    while (n && n.nodeType === 3 && !n.nodeValue.trim()) n = n.previousSibling;
    return n && n.nodeType === 8 ? n : null;
  }
  /** Verschiebt eine Sektion (mit Kommentar) vor `before` (null = ans Ende). */
  function moveNode(el, before) {
    var parent = el.parentNode, com = leadComment(el), anchor = before ? (leadComment(before) || before) : null;
    if (com) { parent.insertBefore(com, anchor); parent.insertBefore(el.ownerDocument.createTextNode("\n  "), anchor); }
    parent.insertBefore(el, anchor);
    parent.insertBefore(el.ownerDocument.createTextNode("\n\n  "), anchor);
  }

  /** Bild lesen, große Bilder verkleinern. msg = Fehlertexte in der UI-Sprache. */
  function readImage(file, msg) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return reject(new Error(msg.type));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error(msg.read)); };
      fr.onload = function () {
        var url = fr.result;
        var img = new Image();
        img.onload = function () {
          var max = 2000, w = img.naturalWidth, hh = img.naturalHeight;
          if (file.type === "image/gif" || (w <= max && hh <= max && file.size < 1.5e6)) {
            if (file.size > 3e6) return reject(new Error(msg.size));
            return resolve({ dataUrl: url, ext: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[file.type] });
          }
          var sc = Math.min(1, max / Math.max(w, hh)), cv = document.createElement("canvas");
          cv.width = Math.round(w * sc); cv.height = Math.round(hh * sc);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          var png = file.type === "image/png" && w * hh < 1.5e6;
          resolve({ dataUrl: cv.toDataURL(png ? "image/png" : "image/jpeg", 0.85), ext: png ? "png" : "jpg" });
        };
        img.onerror = function () { reject(new Error(msg.read)); };
        img.src = url;
      };
      fr.readAsDataURL(file);
    });
  }
  function uploadName(file, ext) {
    return "img/up-" + Date.now().toString(36) + "-" + slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 30) + "." + ext;
  }

  /**
   * Automatische Übersetzung: nach einer Tipp-Pause wird der deutsche Text in alle
   * gesperrten Sprachen übersetzt (/api/translate). Ältere Antworten werden verworfen.
   */
  function autoTranslator(onResult, onStatus) {
    var timer = null, seq = 0;
    return function schedule(text, langs, now) {
      clearTimeout(timer);
      if (!langs.length) { onStatus("idle"); return; }
      var my = ++seq;
      onStatus("wait");
      timer = setTimeout(function () {
        onStatus("busy");
        fetch("/api/translate", { method: "POST", credentials: "same-origin", headers: { "x-mk-admin": "1", "content-type": "application/json" }, body: JSON.stringify({ text: text, to: langs }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; }); })
          .then(function (j) {
            if (my !== seq) return;
            Object.keys(j.translations || {}).forEach(function (l) { onResult(l, j.translations[l]); });
            var f = Object.keys(j.failed || {});
            onStatus(f.length ? "error" : "done", f.length ? f.map(function (l) { return l.toUpperCase() + ": " + j.failed[l]; }).join(" · ") : "");
          })
          .catch(function (e) { if (my === seq) onStatus("error", e.message); });
      }, now ? 0 : 900);
    };
  }

  /**
   * Formatiertes Textfeld ohne sichtbaren Code: „Nightclub <span>Maxim.</span>“ erscheint
   * als Text mit hervorgehobenem Wort. Verhält sich wie ein <textarea> (value, readOnly, input-Event).
   */
  var RICH_OK = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, SMALL: 1, SPAN: 1, BR: 1, MARK: 1, SUP: 1, SUB: 1, A: 1 };
  function cleanInline(html) {
    var d = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html").body;
    (function walk(n) {
      Array.prototype.slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 8) { c.remove(); return; }
        if (c.nodeType !== 1) return;
        if (!RICH_OK[c.tagName]) { walk(c); c.replaceWith.apply(c, Array.prototype.slice.call(c.childNodes)); return; }
        Array.prototype.slice.call(c.attributes).forEach(function (a) { if (!/^(class|href|target|rel|data-[\w-]+)$/.test(a.name) || /^\s*javascript:/i.test(a.value)) c.removeAttribute(a.name); });
        walk(c);
      });
    })(d);
    return d.innerHTML;
  }
  function richField(cls) {
    var el = document.createElement("div");
    el.className = "inp rich" + (cls ? " " + cls : "");
    el.contentEditable = "true";
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    Object.defineProperty(el, "value", {
      get: function () { return el.innerHTML.replace(/<br>$/, "").replace(/\u00a0/g, "&nbsp;"); },
      set: function (v) { el.innerHTML = cleanInline(String(v == null ? "" : v)); }
    });
    Object.defineProperty(el, "readOnly", {
      get: function () { return el.contentEditable !== "true"; },
      set: function (v) { el.contentEditable = v ? "false" : "true"; el.setAttribute("aria-readonly", v ? "true" : "false"); }
    });
    // Einfügen nur als reiner Text; Enter = Zeilenumbruch
    el.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, t);
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); }
    });
    return el;
  }

  window.MKEdit = {
    richField: richField,
    autoTranslator: autoTranslator,
    h: h, encPath: encPath, toEditable: toEditable, fromEditable: fromEditable, slugify: slugify,
    loadPage: loadPage, serialize: serialize, pageDirty: pageDirty, blockList: blockList, blockName: blockName,
    updateMkStyle: updateMkStyle, overridesJs: overridesJs, ensureOverridesTag: ensureOverridesTag,
    previewHtml: previewHtml, loadFrame: loadFrame, restoreScroll: restoreScroll, isTexty: isTexty, pickTarget: pickTarget, moveNode: moveNode,
    readImage: readImage, uploadName: uploadName
  };
})();
