/* Kunden-Admin unter /<slug>/admin/ – der Kunde bearbeitet nur seine eigene Seite.
   Speichern = sofort ein Commit (GitHub) → Vercel deployt automatisch. */
(function () {
  "use strict";

  var E = window.MKEdit, h = E.h;
  var $ = function (id) { return document.getElementById(id); };
  var SLUG = (location.pathname.match(/^\/([^/]+)\/admin(\/|$)/) || [])[1] || "";
  var DRAFT_KEY = "mk-client-draft-" + SLUG;
  var IDLE_MS = 30 * 60 * 1000;
  var LABELS = { header: "Kopfzeile & Menü", footer: "Fußzeile", mobileBar: "Untere Buttonleiste (Handy)", loader: "Lade-Animation", progress: "Fortschrittsbalken", lightbox: "Bildvergrößerung", hero: "Startbereich (ganz oben)", section: "Abschnitt" };
  var IMG_MSG = { type: "Bitte ein JPG-, PNG-, WebP- oder GIF-Bild wählen.", read: "Das Bild kann nicht gelesen werden.", size: "Das Bild ist zu groß (max. 3 MB)." };
  var LANG_NAMES = { de: "Deutsch", en: "Englisch", hu: "Ungarisch", sk: "Slowakisch", cs: "Tschechisch", pl: "Polnisch", it: "Italienisch", fr: "Französisch", es: "Spanisch", ro: "Rumänisch", hr: "Kroatisch" };

  var S = { info: null, page: null, base: "/", sel: null, device: "mobile", pending: {}, invite: null, unlocked: {}, ptab: "sections" };

  // ------------------------------------------------------------ Hilfen
  function show(id) { ["vBoot", "vMissing", "vAuth", "vApp"].forEach(function (v) { $(v).classList.toggle("hidden", v !== id); }); }
  function toast(msg, bad) {
    var t = h("div", { class: "toast" + (bad ? " bad" : ""), text: msg, role: "status" });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
  }
  function api(action, body) {
    var q = "/api/client?a=" + action + (action === "status" ? "&site=" + encodeURIComponent(SLUG) : "");
    var opts = { credentials: "same-origin", headers: { "x-mk-admin": "1" } };
    if (body !== undefined) { opts.method = "POST"; opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(q, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ("Fehler " + r.status)); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }
  function ask(title, body, yes, danger) {
    return new Promise(function (resolve) {
      $("dlgTitle").textContent = title;
      var b = $("dlgBody"); b.innerHTML = "";
      if (typeof body === "string") b.append(h("p", { class: "muted", text: body })); else if (body) b.append(body);
      $("dlgYes").textContent = yes || "OK";
      $("dlgYes").className = "btn " + (danger ? "danger" : "primary");
      var d = $("dlg");
      function done(v) { d.close(); $("dlgYes").onclick = $("dlgNo").onclick = null; resolve(v); }
      $("dlgYes").onclick = function () { done(true); };
      $("dlgNo").onclick = function () { done(false); };
      d.oncancel = function (e) { e.preventDefault(); done(false); };
      d.showModal();
    });
  }
  function helpUrl(extra) {
    var name = S.info ? S.info.site.name : SLUG;
    var who = S.info && S.info.account ? " (" + S.info.account.name + ")" : "";
    return "https://wa.me/" + (S.info ? S.info.help : "36206270766") + "?text=" + encodeURIComponent("Hallo! Ich brauche Hilfe mit meiner Website " + name + who + "." + (extra || ""));
  }

  // ------------------------------------------------------------ Branding
  function abs(u) { return !u ? u : /^(https?:|data:|\/)/.test(u) ? u : "/" + SLUG + "/" + u; }
  function logoEl() {
    var b = S.info.brand;
    if (b.logo) return h("img", { src: abs(b.logo), alt: b.name });
    // „MAXIM Wien“ → zweites Wort in Akzentfarbe; „erotik-homepage .com“ → „.com“ ohne Abstand
    var w = String(b.wordmark || b.name).trim(), i = w.search(/\s/);
    var first = i < 0 ? w : w.slice(0, i), rest = i < 0 ? "" : w.slice(i + 1).trim();
    var cls = "wordmark" + (w.replace(/\s/g, "").length > 14 ? " long" : "");
    return h("span", { class: cls }, first, rest ? h("i", { text: (rest[0] === "." ? "" : " ") + rest }) : null);
  }
  function applyBrand() {
    var b = S.info.brand, r = document.documentElement.style;
    r.setProperty("--bg", b.bg); r.setProperty("--accent", b.accent); r.setProperty("--text", b.text);
    // Textfarbe auf dem Akzent: hell oder dunkel je nach Helligkeit
    var c = b.accent.replace("#", ""); if (c.length === 3) c = c.replace(/./g, "$&$&");
    var lum = (0.299 * parseInt(c.slice(0, 2), 16) + 0.587 * parseInt(c.slice(2, 4), 16) + 0.114 * parseInt(c.slice(4, 6), 16)) / 255;
    r.setProperty("--accent-ink", lum > 0.62 ? "#111" : "#fff");
    if (b.font) {
      document.head.append(h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(b.font).replace(/%20/g, "+") + ":wght@400;600;700;800&display=swap" }));
      r.setProperty("--font", "\"" + b.font + "\"");
    }
    $("metaTheme").setAttribute("content", b.bg);
    if (b.icon) $("favicon").setAttribute("href", abs(b.icon));
    document.title = "Admin · " + b.name;
    $("authLogo").innerHTML = ""; $("authLogo").append(logoEl());
    $("barLogo").innerHTML = ""; $("barLogo").append(logoEl());
    $("viewLink").href = "/" + SLUG + "/";
    Array.prototype.forEach.call(document.querySelectorAll(".help-link"), function (a) { a.href = helpUrl(); a.target = "_blank"; a.rel = "noopener"; });
  }

  // ------------------------------------------------------------ Start
  function boot() {
    if (!SLUG) return show("vMissing");
    api("status").then(function (j) {
      S.info = j; applyBrand();
      var inv = (location.hash.match(/invite=([\w-]+)/) || [])[1];
      if (inv) return startInvite(inv);
      if (j.loggedIn) return startApp();
      showLogin();
    }).catch(function (e) {
      if (e.status === 404) return show("vMissing");
      show("vMissing"); toast(e.message, true);
    });
  }
  function authForm(id) {
    show("vAuth");
    ["fLogin", "fCode", "fRegister", "sOffer"].forEach(function (f) { $(f).classList.toggle("hidden", f !== id); });
  }

  // ------------------------------------------------------------ Login
  var pre = null;
  function showLogin(msg) {
    authForm("fLogin");
    $("loginSub").textContent = "Melde dich an, um " + S.info.site.name + " zu bearbeiten.";
    $("lgErr").textContent = msg || ""; $("lgPw").value = "";
    ($("lgUser").value ? $("lgPw") : $("lgUser")).focus();
  }
  $("fLogin").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button"); btn.disabled = true; $("lgErr").textContent = "";
    api("login", { site: SLUG, username: $("lgUser").value, password: $("lgPw").value }).then(function (j) {
      $("lgPw").value = "";
      if (j.pre) { pre = j.pre; authForm("fCode"); $("lgCode").value = ""; $("codeErr").textContent = ""; $("lgCode").focus(); return; }
      refreshAndStart();
    }).catch(function (err) { $("lgErr").textContent = err.message; }).finally(function () { btn.disabled = false; });
  });
  $("fCode").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button:not([type])"); btn.disabled = true;
    api("verify", { pre: pre, code: $("lgCode").value }).then(function () { pre = null; refreshAndStart(); })
      .catch(function (err) {
        if (err.data && err.data.restart) return showLogin(err.message);
        $("codeErr").textContent = err.message; $("lgCode").select();
      }).finally(function () { btn.disabled = false; });
  });
  $("lgCode").addEventListener("input", function () { if (this.value.replace(/\D/g, "").length === 6) $("fCode").requestSubmit(); });
  $("codeBack").onclick = function () { showLogin(); };
  function refreshAndStart() { return api("status").then(function (j) { S.info = j; startApp(); }); }

  // ------------------------------------------------------------ Einladung / Registrierung
  function startInvite(token) {
    api("invite", { token: token }).then(function (j) {
      if (j.site && j.site !== SLUG) { location.href = "/" + j.site + "/admin/#invite=" + token; return; }
      S.invite = { token: token, kind: j.kind };
      authForm("fRegister");
      var reset = j.kind === "reset";
      $("regNew").classList.toggle("hidden", reset);
      $("regTitle").textContent = reset ? "Neues Passwort" : "Willkommen!";
      $("regSub").textContent = reset ? "Hallo " + j.name + ", lege jetzt dein neues Passwort fest. Dein Benutzername bleibt: " + j.username : "Lege jetzt deinen persönlichen Zugang für " + S.info.site.name + " an. Damit kannst du deine Website jederzeit selbst bearbeiten.";
      $("rgBtn").textContent = reset ? "Passwort speichern" : "Zugang anlegen";
      if (!reset && j.name) $("rgName").value = j.name;
      (reset ? $("rgPw") : j.name ? $("rgUser") : $("rgName")).focus();
    }).catch(function (e) {
      history.replaceState(null, "", location.pathname);
      showLogin(e.message);
    });
  }
  $("fRegister").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("rgErr"); err.textContent = "";
    var reset = S.invite.kind === "reset";
    if (!reset && !$("rgName").value.trim()) { err.textContent = "Bitte gib deinen Namen ein."; return; }
    if ($("rgPw").value.length < 10) { err.textContent = "Das Passwort muss mindestens 10 Zeichen haben."; return; }
    if ($("rgPw").value !== $("rgPw2").value) { err.textContent = "Die beiden Passwörter stimmen nicht überein."; return; }
    var btn = $("rgBtn"); btn.disabled = true;
    api("register", { token: S.invite.token, name: $("rgName").value, username: $("rgUser").value, password: $("rgPw").value }).then(function (j) {
      history.replaceState(null, "", location.pathname);
      $("rgPw").value = $("rgPw2").value = "";
      return api("status").then(function (st) {
        S.info = st;
        if (!j.account.totp) authForm("sOffer"); else startApp();
      });
    }).catch(function (e2) { err.textContent = e2.message; }).finally(function () { btn.disabled = false; });
  });
  $("offerLater").onclick = function () { startApp(); };
  $("offerNow").onclick = function () { setupTotp().then(function (ok) { startApp(); if (ok) toast("Zwei-Faktor-Anmeldung ist aktiv ✓"); }); };

  // ------------------------------------------------------------ 2FA einrichten
  function base32(bytes) {
    var a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", bits = 0, val = 0, out = "";
    bytes.forEach(function (b) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += a[(val >>> (bits - 5)) & 31]; bits -= 5; } });
    if (bits > 0) out += a[(val << (5 - bits)) & 31];
    return out;
  }
  function setupTotp() {
    return new Promise(function (resolve) {
      var secret = base32(crypto.getRandomValues(new Uint8Array(20)));
      var acc = S.info.account || {}, issuer = S.info.site.name;
      var uri = "otpauth://totp/" + encodeURIComponent(issuer + ":" + (acc.username || "admin")) + "?secret=" + secret + "&issuer=" + encodeURIComponent(issuer) + "&algorithm=SHA1&digits=6&period=30";
      var qr = qrcode(0, "M"); qr.addData(uri); qr.make();
      $("qr").innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      $("totpSecret").textContent = secret.replace(/(.{4})/g, "$1 ").trim();
      $("totpCode").value = ""; $("totpErr").textContent = "";
      var d = $("dTotp");
      function done(v) { d.close(); $("totpOk").onclick = $("totpCancel").onclick = null; resolve(v); }
      $("totpCancel").onclick = function () { done(false); };
      d.oncancel = function (e) { e.preventDefault(); done(false); };
      $("totpOk").onclick = function () {
        $("totpOk").disabled = true;
        api("totp", { action: "enable", secret: secret, code: $("totpCode").value }).then(function () {
          if (S.info.account) S.info.account.totp = true;
          renderMenu(); done(true);
        }).catch(function (e) { $("totpErr").textContent = e.message; }).finally(function () { $("totpOk").disabled = false; });
      };
      d.showModal();
      $("totpCode").focus();
    });
  }

  // ------------------------------------------------------------ Editor starten
  function startApp() {
    show("vApp"); bumpIdle(); renderMenu();
    $("blocks").innerHTML = ""; $("blocks").append(h("li", null, h("div", { class: "spin" })));
    loadSource().then(offerDraft).catch(function (e) {
      if (e.status === 401) return showLogin("Bitte melde dich an.");
      toast(e.message, true);
    });
  }
  function loadSource() {
    return api("source").then(function (j) {
      S.base = j.base; S.page = E.loadPage(SLUG, j); S.sel = null;
      renderBlocks(); renderInspector(); renderPreview(); updateSaveBar(); setPanelTab(S.ptab);
    });
  }

  // ------------------------------------------------------------ Entwurf (lokal)
  var draftT;
  function saveDraftSoon() { clearTimeout(draftT); draftT = setTimeout(saveDraft, 400); }
  function saveDraft() {
    var p = S.page; if (!p) return;
    try {
      if (!dirty()) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), htmlSha: p.htmlSha, html: E.serialize(p), overrides: p.overrides, uploads: p.uploads }));
    } catch (e) { /* Speicher voll – Entwurf bleibt nur im Speicher */ }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  function offerDraft() {
    var d; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { d = null; }
    if (!d) return;
    var when = new Date(d.at).toLocaleString("de-AT", { dateStyle: "medium", timeStyle: "short" });
    ask("Weitermachen, wo du aufgehört hast?", "Es gibt noch nicht gespeicherte Änderungen vom " + when + ".", "Wiederherstellen").then(function (yes) {
      if (!yes) { clearDraft(); return; }
      var p = S.page;
      p.doc = new DOMParser().parseFromString(d.html, "text/html");
      p.overrides = d.overrides || {};
      p.uploads = d.uploads || [];
      renderBlocks(); renderPreview(); updateSaveBar();
    });
  }

  // ------------------------------------------------------------ Vorschau
  var frame = $("frame");
  function fdoc() { try { return frame.contentDocument; } catch (e) { return null; } }
  function live(el) {
    var p = S.page, d = fdoc();
    if (!p || !d || !p.idx || !p.idx.has(el)) return null;
    return d.querySelector('[data-mk="' + p.idx.get(el) + '"]');
  }
  function renderPreview() {
    var p = S.page; if (!p) return;
    var y = 0; try { y = frame.contentWindow.scrollY || 0; } catch (e) {}
    var html = E.previewHtml(p, S.base, S.pending);
    frame.onload = function () { wireFrame(y); };
    frame.srcdoc = html;
  }
  var hoverEl = null;
  function wireFrame(y) {
    var d = fdoc(); if (!d) return;
    var st = d.createElement("style");
    st.textContent = ".mk-hover{outline:2px dashed " + S.info.brand.accent + "!important;outline-offset:2px!important;cursor:pointer!important}.mk-sel{outline:3px solid " + S.info.brand.accent + "!important;outline-offset:2px!important}" +
      "img.mk-show{opacity:1!important;visibility:visible!important;z-index:50!important;transform:none!important;filter:none!important}";
    d.head.appendChild(st);
    if (y) setTimeout(function () { try { frame.contentWindow.scrollTo(0, y); } catch (e) {} }, 60);
    d.addEventListener("mouseover", function (e) {
      var t = e.target.closest && e.target.closest("[data-mk]");
      if (hoverEl && hoverEl !== t) hoverEl.classList.remove("mk-hover");
      hoverEl = t;
      if (t && !/^(BODY|HTML)$/.test(t.tagName)) t.classList.add("mk-hover");
    }, true);
    d.addEventListener("mouseout", function () { if (hoverEl) hoverEl.classList.remove("mk-hover"); }, true);
    d.addEventListener("click", function (e) {
      var t = E.pickTarget(d, e, S.page);
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      var el = S.page.els[Number(t.getAttribute("data-mk"))];
      if (el && !/^(BODY|HTML)$/.test(el.tagName)) select(el);
    }, true);
    d.addEventListener("submit", function (e) { e.preventDefault(); }, true);
    markSel(); fitFrame();
  }
  function markSel() {
    var d = fdoc(); if (!d) return;
    Array.prototype.forEach.call(d.querySelectorAll(".mk-sel,.mk-show"), function (x) { x.classList.remove("mk-sel", "mk-show"); });
    if (S.sel) { var l = live(S.sel); if (l) { l.classList.add("mk-sel"); if (l.tagName === "IMG") l.classList.add("mk-show"); } }
  }
  function select(el) {
    S.sel = el; renderInspector(); markSel(); openPanel(true);
    $("panel").scrollTop = 0;
  }
  function scrollToLive(el) { var l = live(el); if (l) l.scrollIntoView({ behavior: "smooth", block: "start" }); }

  // Computer-Ansicht: 1280 px breite Seite passend verkleinern
  function fitFrame() {
    var wrap = $("frameWrap"), stage = $("stage");
    if (S.device !== "desktop") { wrap.style.width = wrap.style.height = frame.style.transform = frame.style.height = ""; return; }
    var narrow = innerWidth <= 860, pad = narrow ? 0 : 44;
    var w = Math.min(stage.clientWidth - pad, 1280), hh = stage.clientHeight - pad, sc = w / 1280;
    wrap.style.width = w + "px"; wrap.style.height = hh + "px";
    frame.style.transform = "scale(" + sc + ")"; frame.style.height = (hh / sc) + "px";
  }
  addEventListener("resize", fitFrame);
  $("devSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.device = b.dataset.dev;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("on", x === b); });
    $("frameWrap").className = "frame-wrap " + S.device;
    fitFrame();
  });

  // ------------------------------------------------------------ Panel: Abschnitte | Bilder | Design
  // Was der Kunde bearbeiten darf, legt der Betreiber je Seite fest (Einstellungen → Funktionen)
  function allowedTab(t) {
    var f = (S.info && S.info.features) || {};
    if (t === "sections" && f.sections === false) return false;
    if (t === "design" && f.design === false) return false;
    return true;
  }
  function setPanelTab(t) {
    var f = (S.info && S.info.features) || {};
    $("ptabs").querySelector('[data-p="sections"]').classList.toggle("hidden", f.sections === false);
    $("ptabs").querySelector('[data-p="design"]').classList.toggle("hidden", f.design === false);
    if (!allowedTab(t)) t = "images";
    S.ptab = t;
    Array.prototype.forEach.call($("ptabs").children, function (b) { b.classList.toggle("on", b.dataset.p === t); b.setAttribute("aria-selected", b.dataset.p === t ? "true" : "false"); });
    $("pSections").classList.toggle("hidden", t !== "sections");
    $("pImages").classList.toggle("hidden", t !== "images");
    $("pDesign").classList.toggle("hidden", t !== "design");
    if (t === "images") renderImages();
    if (t === "design") renderThemes();
  }
  $("ptabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setPanelTab(b.dataset.p); });

  function sectionOf(el) {
    var blocks = E.blockList(S.page.doc);
    for (var n = el; n; n = n.parentElement) for (var i = 0; i < blocks.length; i++) if (blocks[i].el === n) return n;
    return null;
  }
  function imgSrc(el) {
    var l = live(el);
    if (l && (l.currentSrc || l.src)) return l.currentSrc || l.src;
    var src = el.getAttribute("src") || "";
    return S.pending[src] || (/^(data:|https?:|\/)/.test(src) ? src : S.base + src);
  }
  function renderImages() {
    var box = $("imgList"); box.innerHTML = "";
    var p = S.page; if (!p) return;
    var groups = [], bySec = new Map();
    Array.prototype.forEach.call(p.doc.querySelectorAll("img"), function (img) {
      if (img.closest(".ld")) return; // Lade-Animation
      var sec = sectionOf(img), k = sec || "other";
      if (!bySec.has(k)) { bySec.set(k, []); groups.push(k); }
      bySec.get(k).push(img);
    });
    if (!groups.length) { box.append(h("p", { class: "hint", text: "Auf dieser Seite gibt es keine Bilder." })); return; }
    var uploaded = {}; p.uploads.forEach(function (u) { uploaded[u.path] = 1; });
    groups.forEach(function (k) {
      var title = k === "other" ? "Weitere Bilder" : E.blockName(k, LABELS)[0];
      box.append(h("section", { class: "img-grp" }, h("h3", { text: title }),
        h("div", { class: "img-items" }, bySec.get(k).map(function (img) {
          return h("button", { class: "img-item" + (S.sel === img ? " on" : ""), type: "button", title: "Zeigen & ersetzen", onclick: function () { showImage(img); } },
            h("img", { src: imgSrc(img), alt: "", loading: "lazy" }),
            uploaded[img.getAttribute("src")] ? h("span", { class: "new", text: "Neu" }) : null,
            h("span", { class: "cap", text: img.getAttribute("alt") || "Bild" }));
        }))));
    });
  }
  // ------------------------------------------------------------ Design (Farben)
  function currentTheme() { return S.page.doc.documentElement.getAttribute("data-mk-theme") || "standard"; }
  function setTheme(id) {
    var doc = S.page.doc, t = (S.info.themes || []).filter(function (x) { return x.id === id; })[0];
    var old = doc.getElementById("mk-theme"); if (old) old.remove();
    doc.documentElement.removeAttribute("data-mk-theme");
    if (t && t.css) {
      doc.documentElement.setAttribute("data-mk-theme", id);
      var st = doc.createElement("style"); st.id = "mk-theme"; st.textContent = t.css;
      doc.head.appendChild(st);
    }
    renderPreview(); renderThemes(); changed();
  }
  function renderThemes() {
    var box = $("themeList"); box.innerHTML = "";
    if (!S.page) return;
    var cur = currentTheme();
    (S.info.themes || []).forEach(function (t) {
      var sw = t.swatch ? t.swatch.map(function (c) { return h("i", { style: "background:" + c }); }) : [h("i", { class: "orig", text: "Original" })];
      box.append(h("button", { class: "theme" + (t.id === cur ? " on" : ""), type: "button", "aria-pressed": t.id === cur ? "true" : "false", onclick: function () { if (t.id !== cur) setTheme(t.id); } },
        h("span", { class: "sw" + (t.light ? " light" : "") }, sw),
        h("span", { class: "tt" }, h("b", { text: t.name }), h("small", { text: t.desc })),
        t.id === cur ? h("span", { class: "chk", text: "✓" }) : null));
    });
  }

  function showImage(img) {
    select(img);
    var l = live(img);
    if (l) l.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  // ------------------------------------------------------------ Bearbeiten-Blatt (Handy)
  function openPanel(open) { $("panel").classList.toggle("open", open); }
  $("btnSections").onclick = function () { S.sel = null; renderInspector(); markSel(); openPanel(!$("panel").classList.contains("open") || !!S.sel); };
  $("panelGrip").onclick = function () { openPanel(false); };
  (function () { // nach unten wischen schließt
    var y0 = null;
    $("panel").addEventListener("touchstart", function (e) { y0 = this.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    $("panel").addEventListener("touchend", function (e) { if (y0 !== null && e.changedTouches[0].clientY - y0 > 80) openPanel(false); y0 = null; }, { passive: true });
  })();

  // ------------------------------------------------------------ Änderungen
  function dirty() { return !!S.page && E.pageDirty(S.page); }
  function changed(opts) {
    opts = opts || {};
    if (opts.preview) renderPreview();
    if (opts.style) {
      var css = E.updateMkStyle(S.page.doc), d = fdoc();
      if (d) {
        var st = d.getElementById("mk-admin-style");
        if (!st && css) { st = d.createElement("style"); st.id = "mk-admin-style"; d.head.appendChild(st); }
        if (st) st.textContent = css;
      }
    }
    updateSaveBar(); saveDraftSoon();
  }
  function setAttr(el, name, val) {
    [el, live(el)].forEach(function (x) { if (!x) return; if (val == null) x.removeAttribute(name); else x.setAttribute(name, val); });
    changed();
  }
  function toggleOff(el) {
    var off = !el.hasAttribute("data-mk-off");
    [el, live(el)].forEach(function (x) { if (!x) return; if (off) x.setAttribute("data-mk-off", ""); else x.removeAttribute("data-mk-off"); });
    changed({ style: true }); renderBlocks(); renderInspector();
  }
  function moveBlock(el, before) {
    if (before === el) return;
    E.moveNode(el, before);
    var l = live(el), lb = before ? live(before) : null;
    if (l && (lb || !before)) { l.parentNode.insertBefore(l, lb); changed(); } else changed({ preview: true });
    renderBlocks();
    scrollToLive(el);
  }

  // ------------------------------------------------------------ Abschnitte
  function renderBlocks() {
    var p = S.page, ul = $("blocks"); ul.innerHTML = "";
    if (!p) return;
    var list = E.blockList(p.doc).filter(function (b) { return !b.el.classList.contains("ld"); });
    var movables = list.filter(function (b) { return b.movable; }).map(function (b) { return b.el; });
    list.forEach(function (b) {
      var nm = E.blockName(b.el, LABELS), off = b.el.hasAttribute("data-mk-off");
      var i = movables.indexOf(b.el);
      var li = h("li", { class: "blk" + (off ? " off" : ""), draggable: b.movable ? "true" : null },
        h("span", { class: "grip" + (b.movable ? "" : " fixed"), "aria-hidden": "true" }, b.movable ? "⋮⋮" : "•"),
        h("span", { class: "blk-name", onclick: function () { scrollToLive(b.el); openPanel(false); } }, h("b", { text: nm[0] })),
        h("span", { class: "acts" },
          b.movable ? h("button", { class: "btn ghost", title: "Nach oben", "aria-label": "Nach oben", disabled: i === 0, onclick: function () { moveBlock(b.el, movables[i - 1]); } }, svgUp()) : null,
          b.movable ? h("button", { class: "btn ghost", title: "Nach unten", "aria-label": "Nach unten", disabled: i === movables.length - 1, onclick: function () { moveBlock(b.el, movables[i + 1].nextElementSibling); } }, svgDown()) : null,
          h("button", { class: "btn ghost", title: off ? "Einblenden" : "Ausblenden", "aria-label": off ? "Einblenden" : "Ausblenden", onclick: function () { toggleOff(b.el); } }, off ? svgEyeOff() : svgEye())));
      if (b.movable) {
        li.addEventListener("dragstart", function (e) { S.drag = b.el; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x"); });
        li.addEventListener("dragend", function () { S.drag = null; li.classList.remove("dragging"); clearDrop(); });
        li.addEventListener("dragover", function (e) {
          if (!S.drag || S.drag === b.el) return;
          e.preventDefault(); clearDrop();
          var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
          li.classList.add(after ? "drop-after" : "drop-before"); li._after = after;
        });
        li.addEventListener("drop", function (e) { e.preventDefault(); if (S.drag && S.drag !== b.el) moveBlock(S.drag, li._after ? b.el.nextElementSibling : b.el); });
      }
      ul.append(li);
    });
  }
  function clearDrop() { Array.prototype.forEach.call(document.querySelectorAll(".drop-before,.drop-after"), function (x) { x.classList.remove("drop-before", "drop-after"); }); }
  function svg(d) { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = d; return s; }
  function svgUp() { return svg('<path d="M6 15l6-6 6 6"/>'); }
  function svgDown() { return svg('<path d="M6 9l6 6 6-6"/>'); }
  function svgEye() { return svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'); }
  function svgEyeOff() { return svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'); }

  // ------------------------------------------------------------ Inspektor
  function field(label, input, hint) { return h("label", { class: "f" }, h("span", null, label), input, hint ? h("span", { class: "hint", text: hint }) : null); }
  function frameI18N() { try { return frame.contentWindow.I18N || null; } catch (e) { return null; } }
  function frameLang() { var d = fdoc(); return d ? (d.documentElement.lang || "de").slice(0, 2) : "de"; }

  function renderInspector() {
    var box = $("insp"); box.innerHTML = "";
    var el = S.sel, p = S.page;
    $("sections").classList.toggle("hidden", !!(el && p && p.doc.contains(el)));
    if (!el || !p || !p.doc.contains(el)) { S.sel = null; return; }
    var key = el.getAttribute("data-i18n") || el.getAttribute("data-i18n-html");
    var kind = el.tagName === "IMG" ? "Bild" : el.tagName === "A" ? "Link / Button" : (key || E.isTexty(el)) ? "Text" : "Bereich";
    var off = el.hasAttribute("data-mk-off");
    var wrap = h("div", { class: "insp" },
      h("div", { class: "insp-head" }, h("b", { text: kind + " bearbeiten" }),
        h("button", { class: "btn sm ghost", onclick: function () { toggleOff(el); }, text: off ? "Einblenden" : "Ausblenden" }),
        h("button", { class: "btn sm ghost icon", "aria-label": "Fertig", title: "Fertig", onclick: function () { S.sel = null; markSel(); renderInspector(); openPanel(false); } }, "✕")));

    if (key) {
      var I = frameI18N() || {};
      var langs = ["de"];
      Object.keys(I).concat(Object.keys(p.overrides)).forEach(function (l) { if (langs.indexOf(l) < 0) langs.push(l); });
      var valOf = function (l) {
        return p.overrides[l] && p.overrides[l][key] != null ? p.overrides[l][key]
          : l === "de" ? ((I.de && I.de[key] != null) ? I.de[key] : el.innerHTML.trim())
          : (I[l] && I[l][key] != null ? I[l][key] : "");
      };
      var others = langs.slice(1), tas = {};
      var auto = !!S.info.translate; // ohne DeepL-Schlüssel: alle Sprachen frei bearbeitbar
      var locked = function (l) { return auto && !S.unlocked[key + "|" + l]; };
      var status = h("p", { class: "tr-status" });
      var setStatus = function (st, msg) {
        status.className = "tr-status " + (auto ? st : "soon");
        status.textContent = !auto ? "Bitte trag die anderen Sprachen vorerst selbst ein – die automatische Übersetzung kommt bald."
          : st === "busy" || st === "wait" ? "Übersetzt…" : st === "error" ? "Übersetzung fehlgeschlagen: " + msg
          : others.some(locked) ? "🔒 Andere Sprachen werden automatisch aus dem Deutschen übersetzt." : "";
      };
      var translate = E.autoTranslator(function (l, txt) {
        if (!locked(l)) return;
        setI18n(el, key, l, txt);
        if (tas[l]) tas[l].value = txt;
      }, setStatus);
      var rows = function (n) { return Math.min(7, Math.max(2, Math.ceil(String(n).length / 38))); };
      var deVal = valOf("de"), de = E.richField();
      de.value = deVal;
      de.addEventListener("input", function () {
        var v = de.value;
        setI18n(el, key, "de", v);
        if (auto) translate(v, others.filter(locked));
      });
      wrap.append(h("label", { class: "f" }, h("span", null, h("span", { class: "lang-tag", text: "DE" }), "Deutsch"), de));
      if (others.length) {
        wrap.append(status);
        var box2 = h("div", { class: "tr-list" });
        others.forEach(function (l) {
          var cur = valOf(l), ta = E.richField();
          ta.value = cur; tas[l] = ta;
          var btn = h("button", { class: "btn sm ghost" + (auto ? "" : " hidden"), type: "button" });
          var paint = function () {
            var lk = locked(l);
            ta.readOnly = lk; ta.classList.toggle("locked", lk);
            btn.textContent = lk ? "🔒 Entsperren" : "Automatisch";
            btn.title = lk ? "Diese Sprache selbst bearbeiten" : "Wieder automatisch aus dem Deutschen übersetzen";
          };
          btn.onclick = function () {
            var k = key + "|" + l;
            if (S.unlocked[k]) { delete S.unlocked[k]; translate(de.value, [l], true); }
            else { S.unlocked[k] = true; ta.focus(); }
            paint(); setStatus("idle");
          };
          ta.addEventListener("input", function () { if (!locked(l)) setI18n(el, key, l, ta.value); });
          paint();
          box2.append(h("div", { class: "tr-row" },
            h("div", { class: "tr-head" }, h("span", null, h("span", { class: "lang-tag", text: l.toUpperCase() }), LANG_NAMES[l] || l), btn), ta));
        });
        wrap.append(h("details", { class: "more", open: !auto }, h("summary", { text: "Übersetzungen (" + others.map(function (l) { return l.toUpperCase(); }).join(", ") + ")" }), box2));
        setStatus("idle");
      }
    } else if (E.isTexty(el)) {
      var hasTags = el.children.length > 0;
      var ta = hasTags ? E.richField() : h("textarea", { class: "inp", rows: 3 });
      ta.value = hasTags ? el.innerHTML.trim() : el.textContent.trim();
      ta.addEventListener("input", function () {
        var v = ta.value, l = live(el);
        if (hasTags) { el.innerHTML = v; if (l) l.innerHTML = v; } else { el.textContent = v; if (l) l.textContent = v; }
        changed();
      });
      wrap.append(field("Text", ta));
    } else if (el.tagName !== "IMG" && el.tagName !== "A") {
      wrap.append(h("p", { class: "hint", text: "Tippe in der Vorschau direkt auf einen Text oder ein Bild in diesem Bereich, um es zu ändern." }));
    }

    if (el.tagName === "A") {
      var href = h("input", { class: "inp", value: el.getAttribute("href") || "", spellcheck: "false", autocapitalize: "off" });
      href.addEventListener("input", function () { setAttr(el, "href", href.value.trim()); });
      var nt = h("input", { type: "checkbox" }); nt.checked = el.getAttribute("target") === "_blank";
      nt.addEventListener("change", function () { setAttr(el, "target", nt.checked ? "_blank" : null); setAttr(el, "rel", nt.checked ? "noopener" : null); });
      wrap.append(field("Wohin führt der Link?", href, "z. B. https://…, tel:+43…, mailto:…"), h("label", { class: "switch" }, nt, "In neuem Tab öffnen"));
    }

    if (el.tagName === "IMG") {
      var l = live(el);
      wrap.append(h("img", { class: "thumb", src: l ? (l.currentSrc || l.src) : "", alt: "" }));
      var fi = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif" });
      fi.addEventListener("change", function () { if (fi.files[0]) replaceImage(el, fi.files[0]); });
      wrap.append(h("span", { class: "btn primary block file-btn", style: "margin:0 0 14px" }, "Bild ersetzen", fi));
      var alt = h("input", { class: "inp", value: el.getAttribute("alt") || "" });
      alt.addEventListener("input", function () { setAttr(el, "alt", alt.value); });
      wrap.append(field("Bildbeschreibung", alt, "Für Google und Menschen, die das Bild nicht sehen können."));
    }
    box.append(wrap);
  }
  function setI18n(el, key, lang, val) {
    var p = S.page;
    (p.overrides[lang] = p.overrides[lang] || {})[key] = val;
    if (lang === "de") el.innerHTML = val;
    var I = frameI18N(); if (I) (I[lang] = I[lang] || {})[key] = val;
    if (frameLang() === lang) { var l = live(el); if (l) l.innerHTML = val; }
    E.ensureOverridesTag(p.doc);
    changed();
  }
  function replaceImage(el, file) {
    E.readImage(file, IMG_MSG).then(function (r) {
      var name = E.uploadName(file, r.ext);
      S.page.uploads.push({ path: name, data: r.dataUrl.split(",")[1], dataUrl: r.dataUrl });
      el.setAttribute("src", name); el.removeAttribute("srcset"); el.removeAttribute("sizes");
      var l = live(el);
      if (l) { l.removeAttribute("srcset"); l.removeAttribute("sizes"); l.setAttribute("src", r.dataUrl); }
      changed(); renderInspector(); if (S.ptab === "images") renderImages();
    }).catch(function (e) { toast(e.message, true); });
  }

  // ------------------------------------------------------------ Speichern
  function updateSaveBar() {
    var d = dirty(), info = $("saveInfo");
    info.textContent = d ? "Nicht gespeichert" : "Alles gespeichert";
    info.classList.toggle("dirty", d);
    $("btnSave").disabled = !d; $("btnDiscard").disabled = !d;
  }
  function summary() {
    var p = S.page, bits = [];
    if (E.serialize(p) !== p.base) bits.push("Inhalt/Abschnitte");
    if (JSON.stringify(p.overrides) !== p.overridesBase) bits.push("Texte");
    if (p.uploads.length) bits.push(p.uploads.length + (p.uploads.length > 1 ? " neue Bilder" : " neues Bild"));
    var baseTheme = (p.base.match(/<html\b[^>]*\sdata-mk-theme="([a-z]+)"/) || [])[1] || "standard";
    if (baseTheme !== currentTheme()) bits.push("Design: " + currentTheme());
    return bits.join(", ");
  }
  $("btnSave").onclick = function () {
    var p = S.page; if (!dirty()) return;
    var body = { summary: summary() };
    if (E.serialize(p) !== p.base) { body.html = E.serialize(p); body.htmlSha = p.htmlSha; }
    if (JSON.stringify(p.overrides) !== p.overridesBase) { body.overrides = p.overrides; body.overridesSha = p.overridesSha; }
    if (p.uploads.length) body.uploads = p.uploads.map(function (u) { return { path: u.path, data: u.data }; });
    var btn = $("btnSave"), label = btn.innerHTML; btn.disabled = true; btn.textContent = "Speichert…";
    api("save", body).then(function (j) {
      clearDraft();
      p.uploads.forEach(function (u) { S.pending[u.path] = u.dataUrl; });
      toast("Gespeichert ✓ Deine Website wird gerade aktualisiert.");
      watchDeploy(j.rev);
      return loadSource();
    }).catch(function (e) {
      saveDraft();
      if (e.status === 401) return showLogin("Bitte melde dich erneut an. Deine Änderungen sind gesichert.");
      if (e.status === 409) return ask("Neu laden?", e.message, "Neu laden").then(function (y) { if (y) location.reload(); });
      toast(e.message, true);
    }).finally(function () { btn.innerHTML = label; updateSaveBar(); });
  };
  $("btnDiscard").onclick = function () {
    ask("Änderungen verwerfen?", "Alles seit dem letzten Speichern geht verloren.", "Verwerfen", true).then(function (y) {
      if (!y) return; clearDraft(); loadSource();
    });
  };

  // Live-Stand beobachten: das gespeicherte HTML trägt <meta name="mk-rev">.
  function watchDeploy(rev) {
    var el = $("deploy"), t0 = Date.now();
    clearTimeout(S.deployT);
    el.innerHTML = ""; el.append(h("span", { class: "spin" }), h("span", { class: "hide-sm", text: "Wird veröffentlicht…" }));
    (function poll() {
      fetch("/" + SLUG + "/?mk=" + Date.now(), { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; }).then(function (t) {
        if (rev && t.indexOf('content="' + rev + '"') >= 0) {
          el.innerHTML = ""; el.append(h("span", { class: "ok", text: "✓ Live" }));
          setTimeout(function () { el.innerHTML = ""; }, 15000);
          return;
        }
        if (Date.now() - t0 > 5 * 60 * 1000) { el.innerHTML = ""; el.append(h("span", { text: "Dauert länger als üblich…" })); return; }
        S.deployT = setTimeout(poll, 4000);
      });
    })();
  }

  // ------------------------------------------------------------ Einstellungen
  function renderMenu() {
    var a = S.info && S.info.account;
    if (!a) return;
    $("accInfo").textContent = a.name + " · Benutzername: " + a.username;
    $("totpState").textContent = a.totp ? "Aktiv – beim Anmelden brauchst du zusätzlich den Code aus deiner App." : "Nicht aktiv. Wir empfehlen, sie einzuschalten.";
    $("totpToggle").textContent = a.totp ? "Ausschalten" : "Jetzt einrichten";
    $("totpToggle").className = "btn " + (a.totp ? "" : "primary");
  }
  $("btnMenu").onclick = function () { renderMenu(); $("dMenu").showModal(); };
  $("menuClose").onclick = function () { $("dMenu").close(); };
  $("dMenu").addEventListener("click", function (e) { if (e.target === this) this.close(); });
  $("totpToggle").onclick = function () {
    var a = S.info.account;
    if (!a.totp) { $("dMenu").close(); setupTotp().then(function (ok) { if (ok) toast("Zwei-Faktor-Anmeldung ist aktiv ✓"); }); return; }
    var pw = h("input", { class: "inp", type: "password", autocomplete: "current-password" });
    ask("Zwei-Faktor ausschalten?", h("div", null, h("p", { class: "muted", text: "Bitte bestätige mit deinem Passwort." }), pw), "Ausschalten", true).then(function (y) {
      if (!y) return;
      api("totp", { action: "disable", password: pw.value }).then(function () { a.totp = false; renderMenu(); toast("Zwei-Faktor-Anmeldung ausgeschaltet"); })
        .catch(function (e) { toast(e.message, true); });
    });
    setTimeout(function () { pw.focus(); }, 50);
  };
  $("fPw").addEventListener("submit", function (e) {
    e.preventDefault();
    $("pwErr").textContent = "";
    if ($("pwNew").value.length < 10) { $("pwErr").textContent = "Mindestens 10 Zeichen."; return; }
    api("password", { old: $("pwOld").value, password: $("pwNew").value }).then(function () {
      $("pwOld").value = $("pwNew").value = ""; toast("Passwort geändert ✓");
    }).catch(function (err) { $("pwErr").textContent = err.message; });
  });
  $("btnLogout").onclick = function () { logout(); };
  function logout(msg) {
    saveDraft();
    if ($("dMenu").open) $("dMenu").close();
    api("logout", {}).catch(function () {}).then(function () { S.page = null; showLogin(msg); });
  }

  var idleT;
  function bumpIdle() {
    clearTimeout(idleT);
    idleT = setTimeout(function () { if (!$("vApp").classList.contains("hidden")) logout("Du wurdest nach 30 Minuten ohne Aktivität abgemeldet. Deine Änderungen sind gesichert."); }, IDLE_MS);
  }
  ["pointerdown", "keydown"].forEach(function (ev) { document.addEventListener(ev, bumpIdle, { passive: true, capture: true }); });

  window.addEventListener("beforeunload", function (e) { if (dirty()) { saveDraft(); e.preventDefault(); e.returnValue = ""; } });

  boot();
})();
