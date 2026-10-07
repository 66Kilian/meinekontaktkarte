/* meinekontaktkarte.com – Admin
   Alles, was hier geändert wird, bleibt ein Entwurf (lokal gespeichert), bis
   „Közzététel“ gedrückt wird. Dann entsteht ein Git-Commit → Vercel deployt. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var ROOT_DOMAIN = "meinekontaktkarte.com";
  var RESERVED = ["admin", "api", "data", "lib", "img", "scripts", "munkak", "munkák", "favicon.ico", "favicon.svg", "robots.txt", "sitemap.xml", "i18n.js", "index.html", "www", "mail", "static", "assets", "_vercel", "404", "impressum"];
  var NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
  // Impressum – gleiche Felder wie lib/impressum.js
  var IMP_FIELDS = [
    ["name", "Név / cégnév", true, "pl. Andrea Kilian-Vörös vagy Maxim Betriebs GmbH"],
    ["legal", "Cégforma", false, "pl. GmbH, e.U. (egyéni vállalkozónál üres)"],
    ["street", "Utca, házszám", true, "pl. Johnstraße 83/1"],
    ["zip", "Irányítószám", true, "pl. 1150"],
    ["city", "Város", true, "pl. Wien"],
    ["country", "Ország", false, "üresen: Österreich"],
    ["email", "E-mail", true, "office@…"],
    ["phone", "Telefon", false, "+43 …"],
    ["uid", "UID-szám", false, "ATU12345678"],
    ["gisa", "GISA-szám", false, "Iparengedély száma"],
    ["fn", "Cégjegyzékszám (FN)", false, "pl. FN 123456a (csak bejegyzett cégnél)"],
    ["court", "Cégbíróság", false, "pl. Handelsgericht Wien"],
    ["purpose", "Vállalkozás tárgya", true, "pl. Betrieb eines Nachtclubs und Escort-Service (18+)"],
    ["chamber", "Kamara", false, "pl. Wirtschaftskammer Wien"],
    ["authority", "Felügyeleti hatóság", false, "pl. Magistratisches Bezirksamt des 15. Bezirks"],
    ["media", "Médiatulajdonos (ha nem az üzemeltető)", false, "Üresen: az üzemeltető, „Adresse wie oben”"],
    ["extra", "Egyéb", false, ""]
  ];
  function impMissing(o) {
    o = o || {};
    var miss = IMP_FIELDS.filter(function (f) { return f[2] && !String(o[f[0]] || "").trim(); }).map(function (f) { return f[0]; });
    if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email) && miss.indexOf("email") < 0) miss.push("email");
    return miss;
  }
  // Funktionen je Seite (wie api/_lib/sites.js FEATURE_KEYS) – fehlt ein Schlüssel, ist sie an
  function featOn(s, k) { return !(s && s.features && s.features[k] === false); }
  function impNeeded(s) { return featOn(s, "impressum") && impMissing(s.impressum).length > 0; }
  function impUrl(s) { return "https://" + ROOT_DOMAIN + "/" + (s.folder ? s.slug + "/" : "") + "impressum/"; }
  var E = window.MKEdit; // gemeinsamer Editor-Kern (mk-edit.js)
  var DRAFT_KEY = "mk-admin-draft";
  var IDLE_MS = 30 * 60 * 1000;

  var S = {
    config: null, configBase: "", configSha: null, discovered: [],
    pages: {}, cur: null, tab: "blocks", device: "mobile", editMode: true, sel: null,
    deploy: null, draftOffer: null, pendingImgs: {}
  };

  // ------------------------------------------------------------ Hilfen
  var L = window.MKI18N, t = L.t; // Sprache: Deutsch (Standard) oder Ungarisch
  // Alle Texte, die über h() entstehen, laufen durch die Übersetzung (Werte von Eingabefeldern nicht).
  var h = function (tag, attrs) {
    if (attrs) ["text", "title", "aria-label", "placeholder"].forEach(function (k) { if (typeof attrs[k] === "string") attrs[k] = t(attrs[k]); });
    var kids = Array.prototype.slice.call(arguments, 2).map(function (c) { return typeof c === "string" ? t(c) : c; });
    return E.h.apply(null, [tag, attrs].concat(kids));
  };
  function show(id) { ["vBoot", "vSetup", "vLogin", "vApp"].forEach(function (v) { $(v).classList.toggle("hidden", v !== id); }); }
  function toast(msg, bad) {
    var el = h("div", { class: "toast" + (bad ? " bad" : ""), text: msg, role: "status" });
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, bad ? 6000 : 2600);
  }
  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString(L.locale, { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return iso; } }
  var toEditable = E.toEditable, fromEditable = E.fromEditable;
  function slugify(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "oldal";
  }

  function api(path, body) {
    var opts = { credentials: "same-origin", headers: { "x-mk-admin": "1" } };
    if (body !== undefined) { opts.method = "POST"; opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch("/api/" + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path.indexOf("auth/") !== 0) { saveDraft(); showLogin("A munkamenet lejárt – jelentkezz be újra. A változtatásaid megmaradtak."); }
        if (!r.ok) { var e = new Error(j.error || ("Hiba " + r.status)); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }

  function ask(title, body, yes, danger) {
    return new Promise(function (resolve) {
      $("dlgTitle").textContent = t(title);
      var b = $("dlgBody"); b.innerHTML = "";
      if (typeof body === "string") b.append(h("p", { class: "muted", text: body })); else if (body) b.append(body);
      $("dlgYes").textContent = t(yes || "OK");
      $("dlgYes").className = "btn " + (danger ? "danger" : "primary");
      $("dlgNo").classList.toggle("hidden", yes === null);
      var d = $("dlg");
      function done(v) { d.close(); $("dlgYes").onclick = $("dlgNo").onclick = null; resolve(v); }
      $("dlgYes").onclick = function () { done(true); };
      $("dlgNo").onclick = function () { done(false); };
      d.oncancel = function (e) { e.preventDefault(); done(false); };
      d.showModal();
    });
  }

  // ------------------------------------------------------------ Login
  var pre = null;
  function showLogin(msg) {
    show("vLogin");
    $("fPw").classList.remove("hidden"); $("fCode").classList.add("hidden"); $("lgStep2").classList.remove("on");
    $("lgErr1").textContent = t(msg || ""); $("lgPw").value = ""; $("lgPw").focus();
  }
  $("fPw").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button"); btn.disabled = true; $("lgErr1").textContent = "";
    api("auth/login", { password: $("lgPw").value }).then(function (j) {
      pre = j.pre; $("lgPw").value = "";
      $("fPw").classList.add("hidden"); $("fCode").classList.remove("hidden"); $("lgStep2").classList.add("on");
      $("lgCode").value = ""; $("lgErr2").textContent = ""; $("lgCode").focus();
    }).catch(function (err) { $("lgErr1").textContent = t(err.message); }).finally(function () { btn.disabled = false; });
  });
  $("fCode").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit],button:not([type])"); btn.disabled = true;
    api("auth/verify", { pre: pre, code: $("lgCode").value }).then(function () {
      pre = null; startApp();
    }).catch(function (err) {
      if (err.data && err.data.restart) return showLogin(err.message);
      $("lgErr2").textContent = t(err.message); $("lgCode").select();
    }).finally(function () { btn.disabled = false; });
  });
  $("lgCode").addEventListener("input", function () {
    var v = this.value.replace(/\D/g, "");
    if (v.length === 6) $("fCode").requestSubmit();
  });
  $("lgBack").onclick = function () { showLogin(); };
  $("btnLogout").onclick = function () { logout(); };
  $("btnClients").onclick = function () { if (S.clientsView) closeClients(); else openClients(); };
  function logout(msg) {
    saveDraft();
    api("auth/logout", {}).catch(function () {}).then(function () { showLogin(msg); });
  }

  // Automatische Abmeldung bei Inaktivität
  var idleT;
  function bumpIdle() {
    clearTimeout(idleT);
    idleT = setTimeout(function () { if (!$("vApp").classList.contains("hidden")) logout("30 perc inaktivitás után automatikusan kiléptettünk."); }, IDLE_MS);
  }
  ["pointerdown", "keydown", "scroll"].forEach(function (ev) { document.addEventListener(ev, bumpIdle, { passive: true, capture: true }); });

  // ------------------------------------------------------------ Start
  function boot() {
    api("auth/status").then(function (s) {
      S.translate = !!s.translate;
      if (!s.configured) return show("vSetup");
      if (!s.loggedIn) return showLogin();
      startApp();
    }).catch(function (e) { show("vSetup"); toast(e.message, true); });
  }

  function startApp() {
    show("vApp"); bumpIdle();
    loadSites().then(function () {
      offerDraft();
      var want = (location.hash.match(/site=([\w-]+)/) || [])[1];
      var first = S.config.sites.find(function (s) { return s.id === want; }) || S.config.sites[0];
      if (first) openSite(first.id);
      // Handy: immer mit der Seitenliste starten
      if (isMobile()) document.body.classList.remove("m-site");
    }).catch(function (e) { toast(e.message, true); });
  }

  function loadSites() {
    return api("sites").then(function (j) {
      S.config = j.config; S.configBase = JSON.stringify(j.config); S.configSha = j.configSha; S.discovered = j.discovered || [];
      S.head = j.head;
      renderSide(); updateSaveBar();
      api("clients").then(function (c) { S.counts = c.counts || {}; renderSide(); }).catch(function () {});
    });
  }

  // ------------------------------------------------------------ Entwürfe
  var draftT;
  function saveDraftSoon() { clearTimeout(draftT); draftT = setTimeout(saveDraft, 400); }
  function saveDraft() {
    if (!S.config) return;
    var d = { at: new Date().toISOString(), configSha: S.configSha, pages: {} };
    if (JSON.stringify(S.config) !== S.configBase) d.config = S.config;
    Object.keys(S.pages).forEach(function (id) {
      var p = S.pages[id];
      if (!p.doc) return;
      var html = serialize(p), ov = JSON.stringify(p.overrides);
      if (html !== p.base || ov !== p.overridesBase) d.pages[id] = { html: html, htmlSha: p.htmlSha, overrides: p.overrides };
    });
    try {
      if (!d.config && !Object.keys(d.pages).length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch (e) { /* Speicher voll/gesperrt – Entwurf bleibt nur im Speicher */ }
  }
  function readDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { return null; } }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  function offerDraft() {
    var d = readDraft();
    if (!d || (!d.config && !Object.keys(d.pages || {}).length)) return;
    var stale = d.configSha !== S.configSha;
    var list = h("ul", null,
      d.config ? h("li", { text: "Beállítások (címek, be/ki, csoportok)" }) : null,
      Object.keys(d.pages).map(function (id) {
        var s = S.config.sites.find(function (x) { return x.id === id; });
        return h("li", { text: (s ? s.name : id) + ": tartalom / szekciók" });
      }));
    var body = h("div", null,
      h("p", { class: "muted", text: "Mentetlen változtatásokat találtunk (" + fmtDate(d.at) + "):" }), list,
      stale ? h("p", { class: "err-text", text: "Figyelem: azóta más is mentett. Ha visszaállítod, a piszkozat felülírhatja azokat a változásokat." }) : null);
    ask("Folytatod, ahol abbahagytad?", body, "Visszaállítás").then(function (yes) {
      if (!yes) { clearDraft(); return; }
      if (d.config) { S.config = d.config; }
      S.draftPages = d.pages || {};
      renderSide(); updateSaveBar();
      if (S.cur) openSite(S.cur, true);
    });
  }

  // ------------------------------------------------------------ Sidebar
  function siteById(id) { return S.config.sites.find(function (s) { return s.id === id; }); }
  function baseSite(id) { return JSON.parse(S.configBase).sites.find(function (s) { return s.id === id; }); }
  function siteUrl(s) { return s.folder ? "https://" + ROOT_DOMAIN + "/" + s.slug + "/" : "https://" + ROOT_DOMAIN + "/"; }
  function siteChanged(s) {
    var b = baseSite(s.id), p = S.pages[s.id];
    return JSON.stringify(b) !== JSON.stringify(s) || !!(p && pageDirty(p));
  }

  function renderSide() {
    var q = $("q").value.trim().toLowerCase();
    var groups = allGroups();
    var box = $("siteList"); box.innerHTML = "";
    groups.forEach(function (g) {
      var all = S.config.sites.filter(function (s) { return s.group === g; });
      var items = all.filter(function (s) {
        return !q || (s.name + " " + s.slug + " " + s.folder + " " + s.subdomain).toLowerCase().indexOf(q) >= 0;
      });
      if (q && !items.length) return;
      var collapsed = !q && sessionStorage.getItem("mk-col-" + g) === "1";
      var list = h("div", { class: "grp-list" + (collapsed ? " hidden" : "") }, items.map(function (s) {
        var n = (S.counts || {})[s.id] || 0;
        var it = h("button", { class: "site-item" + (s.id === S.cur ? " on" : ""), draggable: s.folder ? "true" : null, onclick: function () { openSite(s.id); } },
          h("span", { class: "dot " + (s.enabled ? "ok" : "off"), title: s.enabled ? "Online" : "Kikapcsolva" }),
          h("span", { class: "t" }, h("b", { text: s.name }), h("small", { text: s.folder ? "/" + s.slug + (s.subdomain ? " · " + s.subdomain + "." : "") : "Főoldal" })),
          n ? h("span", { class: "badge", title: n + " ügyfél-admin" }, svgUser(), String(n)) : null,
          impNeeded(s) ? h("span", { class: "pill warn imp-flag", title: t("Hiányzik az impresszum") }, "§") : null,
          siteChanged(s) ? h("span", { class: "chg", title: "Nem közzétett változás" }) : null);
        it.addEventListener("dragstart", function (e) { S.dragSite = s.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.id); });
        it.addEventListener("dragend", function () { S.dragSite = null; clearGrpDrop(); });
        return it;
      }));
      var head = h("div", { class: "grp-head" },
        h("button", { class: "grp-toggle", onclick: function () { sessionStorage.setItem("mk-col-" + g, collapsed ? "0" : "1"); renderSide(); } },
          h("span", { class: "caret", text: collapsed ? "▸" : "▾" }), h("span", { text: g }), h("span", { class: "cnt", text: String(all.length) })),
        h("button", { class: "btn icon sm ghost", title: "Csoport átnevezése", "aria-label": "Csoport átnevezése", onclick: function () { renameGroup(g); } }, "✎"),
        all.length ? null : h("button", { class: "btn icon sm ghost", title: "Üres csoport törlése", "aria-label": "Csoport törlése", onclick: function () { deleteGroup(g); } }, "✕"));
      var grp = h("div", { class: "grp" }, head, list,
        !all.length ? h("div", { class: "grp-empty", text: "Húzz ide egy munkát" }) : null);
      grp.addEventListener("dragover", function (e) { if (!S.dragSite) return; e.preventDefault(); clearGrpDrop(); grp.classList.add("drop"); });
      grp.addEventListener("dragleave", function (e) { if (!grp.contains(e.relatedTarget)) grp.classList.remove("drop"); });
      grp.addEventListener("drop", function (e) {
        e.preventDefault(); clearGrpDrop();
        var s = siteById(S.dragSite); if (!s || s.group === g) return;
        s.group = g; changed(); if (S.cur === s.id && S.tab === "settings") renderSettings();
        toast(s.name + " → " + g);
      });
      box.append(grp);
    });
    box.append(h("button", { class: "btn sm ghost add-grp", text: "+ Új csoport", onclick: function () { newGroup(); } }));
    var nw = $("newWorks"); nw.innerHTML = "";
    S.discovered.filter(function (f) { return !S.config.sites.some(function (s) { return s.folder === f; }); }).forEach(function (f) {
      nw.append(h("div", { class: "newwork" },
        h("span", null, "Új munka a mappában: ", h("b", { text: f.split("/").pop() })),
        h("button", { class: "btn sm", onclick: function () { addWork(f); }, text: "Felvétel az adminba" })));
    });
  }
  function clearGrpDrop() { Array.prototype.forEach.call(document.querySelectorAll(".grp.drop"), function (x) { x.classList.remove("drop"); }); }
  function svgUser() {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24");
    s.innerHTML = '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'; return s;
  }

  // ------------------------------------------------------------ Csoportok
  function allGroups() {
    var groups = (S.config.groups || []).slice();
    S.config.sites.forEach(function (s) { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    return groups;
  }
  function promptText(title, label, value, hint) {
    var i = h("input", { class: "inp", value: value || "" });
    var p = ask(title, h("div", null, field(label, i, hint)), "Mentés");
    setTimeout(function () { i.focus(); i.select(); }, 30);
    i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("dlgYes").click(); } });
    return p.then(function (y) { return y ? i.value.trim().slice(0, 60) : null; });
  }
  function newGroup() {
    return promptText("Új csoport", "Csoport neve", "", "pl. Szaunák, Bárok, Demók, 2026 …").then(function (n) {
      if (!n) return null;
      if (allGroups().indexOf(n) < 0) { S.config.groups = allGroups().concat([n]); changed(); }
      return n;
    });
  }
  function renameGroup(g) {
    promptText("Csoport átnevezése", "Új név", g).then(function (n) {
      if (!n || n === g) return;
      if (allGroups().indexOf(n) >= 0) return toast("Ilyen nevű csoport már van.", true);
      S.config.groups = allGroups().map(function (x) { return x === g ? n : x; });
      S.config.sites.forEach(function (s) { if (s.group === g) s.group = n; });
      changed(); if (S.tab === "settings") renderSettings();
    });
  }
  function deleteGroup(g) {
    S.config.groups = allGroups().filter(function (x) { return x !== g; });
    changed();
  }
  $("q").addEventListener("input", renderSide);

  function addWork(folder) {
    var name = folder.split("/").pop(), base = slugify(name), slug = base, i = 2;
    var used = function (x) { return S.config.sites.some(function (s) { return s.slug === x || (s.aliases || []).indexOf(x) >= 0 || s.id === x; }) || RESERVED.indexOf(x) >= 0; };
    while (used(slug)) slug = base + "-" + i++;
    S.config.sites.push({ id: slug, name: name, group: "Kunden", folder: folder, slug: slug, subdomain: "", enabled: false, aliases: [], notes: "" });
    changed(); openSite(slug); setTab("settings");
    toast("Felvéve – kikapcsolt állapotban. Nézd át, aztán kapcsold be és tedd közzé.");
  }

  // ------------------------------------------------------------ Seite öffnen
  function openSite(id, force) {
    if (S.clientsView) closeClients();
    if (!force && (S.cur !== id || !document.body.classList.contains("m-site"))) { document.body.classList.add("m-site"); if (isMobile()) scrollTo(0, 0); }
    if (S.cur !== id) S.sel = null;
    S.cur = id;
    history.replaceState(null, "", "#site=" + id);
    renderSide(); renderHead();
    var p = S.pages[id];
    if (p && p.doc && !force) { renderTab(); renderPreview(); return; }
    $("blocks").innerHTML = ""; $("insp").innerHTML = "";
    $("blocks").append(h("li", { class: "empty" }, h("div", { class: "spin", style: "margin:0 auto" })));
    var site = siteById(id);
    var q = site && baseSite(id) ? "id=" + encodeURIComponent(id) : "folder=" + encodeURIComponent(site.folder);
    api("source?" + q).then(function (j) {
      var p = S.pages[id] = E.loadPage(id, j);
      var dp = S.draftPages && S.draftPages[id];
      if (dp) {
        p.doc = new DOMParser().parseFromString(dp.html, "text/html");
        p.overrides = dp.overrides || {};
        delete S.draftPages[id];
      }
      if (S.cur === id) { renderTab(); renderPreview(); renderSide(); updateSaveBar(); }
    }).catch(function (e) { toast(e.message, true); });
  }

  function renderHead() {
    var s = siteById(S.cur);
    if (!s) return;
    $("edTitle").innerHTML = "";
    $("edTitle").append(h("span", { text: s.name }), h("span", { class: "pill " + (s.enabled ? "ok" : "off"), text: s.enabled ? "Online" : "Kikapcsolva" }));
    var u = $("edUrl"); u.innerHTML = "";
    var b = baseSite(s.id);
    if (b) {
      u.append(h("a", { href: siteUrl(b), target: "_blank", rel: "noopener", text: siteUrl(b).replace("https://", "") + " ↗" }));
      if (b.subdomain) u.append(h("a", { href: "https://" + b.subdomain + "." + ROOT_DOMAIN + "/", target: "_blank", rel: "noopener", text: b.subdomain + "." + ROOT_DOMAIN + " ↗" }));
    } else u.append(h("span", { class: "muted", text: "Még nincs közzétéve" }));
  }

  function isMobile() { return window.matchMedia && matchMedia("(max-width:720px)").matches; }
  $("mBack").onclick = function () { document.body.classList.remove("m-site", "m-prev"); scrollTo(0, 0); };
  function setTab(t) {
    if (t === "preview") {
      document.body.classList.add("m-prev");
      Array.prototype.forEach.call($("tabs").children, function (b) { b.classList.toggle("on", b.dataset.tab === "preview"); });
      return;
    }
    document.body.classList.remove("m-prev");
    S.tab = t;
    Array.prototype.forEach.call($("tabs").children, function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    renderTab();
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });

  function renderTab() {
    $("tabBlocks").classList.toggle("hidden", S.tab !== "blocks");
    $("tabSettings").classList.toggle("hidden", S.tab !== "settings");
    $("tabHistory").classList.toggle("hidden", S.tab !== "history");
    if (S.tab === "blocks") { renderInspector(); renderBlocks(); }
    if (S.tab === "settings") renderSettings();
    if (S.tab === "history") renderHistory();
  }

  // ------------------------------------------------------------ HTML-Modell
  var serialize = E.serialize, pageDirty = E.pageDirty;
  function curPage() { return S.pages[S.cur]; }

  var blockList = E.blockList;
  var BLOCK_LABELS = { header: "Navigáció / fejléc", footer: "Lábléc", mobileBar: "Mobil alsó gombsor", loader: "Betöltő animáció", progress: "Görgetési csík", lightbox: "Képnagyító (lightbox)", hero: "Hero (nyitó rész)", section: "Szakasz" };
  function blockName(el) { return E.blockName(el, BLOCK_LABELS); }

  var updateMkStyle = E.updateMkStyle;

  // ------------------------------------------------------------ Vorschau
  var frame = $("frame");
  var ensureOverridesTag = E.ensureOverridesTag;

  function renderPreview(keepScroll) {
    var p = curPage(), site = siteById(S.cur);
    if (!p || !p.doc) return;
    var y = 0;
    try { if (keepScroll !== false) y = frame.contentWindow.scrollY || 0; } catch (e) {}
    var baseHref = site.folder ? "/" + encPath(site.folder) + "/" : "/";
    var html = E.previewHtml(p, baseHref, S.pendingImgs[S.cur]);
    frame.onload = function () { wireFrame(y); };
    frame.srcdoc = html;
    $("unpubFlag").classList.toggle("hidden", !pageDirty(p));
  }

  function fdoc() { try { return frame.contentDocument; } catch (e) { return null; } }
  function live(el) {
    var p = curPage(), d = fdoc();
    if (!p || !d || !p.idx || !p.idx.has(el)) return null;
    return d.querySelector('[data-mk="' + p.idx.get(el) + '"]');
  }

  var hoverEl = null;
  function wireFrame(y) {
    var d = fdoc();
    if (!d) return;
    var st = d.createElement("style");
    st.id = "mk-edit-style";
    st.textContent = ".mk-hover{outline:2px dashed #2f6bff!important;outline-offset:2px!important;cursor:pointer!important}.mk-sel{outline:3px solid #ff5a36!important;outline-offset:2px!important}";
    d.head.appendChild(st);
    if (y) setTimeout(function () { try { frame.contentWindow.scrollTo(0, y); } catch (e) {} }, 60);
    d.addEventListener("mouseover", function (e) {
      if (!S.editMode) return;
      var t = e.target.closest && e.target.closest("[data-mk]");
      if (hoverEl && hoverEl !== t) hoverEl.classList.remove("mk-hover");
      hoverEl = t;
      if (t && t.tagName !== "BODY" && t.tagName !== "HTML") t.classList.add("mk-hover");
    }, true);
    d.addEventListener("mouseout", function () { if (hoverEl) hoverEl.classList.remove("mk-hover"); }, true);
    d.addEventListener("click", function (e) {
      if (!S.editMode) return;
      var t = pickTarget(d, e);
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      var el = curPage().els[Number(t.getAttribute("data-mk"))];
      if (el && el.tagName !== "BODY" && el.tagName !== "HTML") select(el);
    }, true);
    d.addEventListener("submit", function (e) { e.preventDefault(); }, true);
    markSel();
  }
  function pickTarget(d, e) { return E.pickTarget(d, e, curPage()); }
  function markSel() {
    var d = fdoc(); if (!d) return;
    Array.prototype.forEach.call(d.querySelectorAll(".mk-sel"), function (x) { x.classList.remove("mk-sel"); });
    if (S.sel) { var l = live(S.sel); if (l) l.classList.add("mk-sel"); }
  }
  function select(el) {
    S.sel = el;
    if (S.tab !== "blocks") setTab("blocks"); else renderInspector();
    markSel();
    $("insp").scrollIntoView({ block: "nearest" });
  }
  function scrollToLive(el) {
    var l = live(el);
    if (l) l.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("devSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.device = b.dataset.dev;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("on", x === b); });
    $("frameWrap").className = "frame-wrap " + S.device;
  });
  $("editMode").addEventListener("change", function () {
    S.editMode = this.checked;
    if (!S.editMode && hoverEl) hoverEl.classList.remove("mk-hover");
  });
  $("btnReload").onclick = function () { renderPreview(); };

  // ------------------------------------------------------------ Änderungen
  function changed(opts) {
    opts = opts || {};
    if (opts.preview) renderPreview();
    if (opts.style) {
      var css = updateMkStyle(curPage().doc), d = fdoc();
      if (d) {
        var st = d.getElementById("mk-admin-style");
        if (!st && css) { st = d.createElement("style"); st.id = "mk-admin-style"; d.head.appendChild(st); }
        if (st) st.textContent = css;
      }
    }
    var p = curPage();
    if (p) $("unpubFlag").classList.toggle("hidden", !pageDirty(p));
    renderSide(); renderHead(); updateSaveBar(); saveDraftSoon();
  }

  function toggleOff(el) {
    var off = !el.hasAttribute("data-mk-off");
    if (off) el.setAttribute("data-mk-off", ""); else el.removeAttribute("data-mk-off");
    var l = live(el);
    if (l) { if (off) l.setAttribute("data-mk-off", ""); else l.removeAttribute("data-mk-off"); }
    changed({ style: true });
    renderBlocks(); renderInspector();
  }

  function moveBlock(el, before) {
    if (before === el) return;
    E.moveNode(el, before);
    var l = live(el), lb = before ? live(before) : null;
    if (l && (lb || !before)) { l.parentNode.insertBefore(l, lb); changed(); }
    else changed({ preview: true });
    renderBlocks();
  }

  // ------------------------------------------------------------ Blöcke
  function renderBlocks() {
    var p = curPage(), ul = $("blocks");
    ul.innerHTML = "";
    if (!p || !p.doc) return;
    var list = blockList(p.doc);
    var movables = list.filter(function (b) { return b.movable; }).map(function (b) { return b.el; });
    list.forEach(function (b) {
      var nm = blockName(b.el), off = b.el.hasAttribute("data-mk-off");
      var li = h("li", { class: "blk" + (off ? " off" : ""), draggable: b.movable ? "true" : null },
        h("span", { class: "grip" + (b.movable ? "" : " fixed"), title: b.movable ? "Húzd a sorrendhez" : "Fix helyen" }, b.movable ? "⋮⋮" : "•"),
        h("span", { class: "blk-name", onclick: function () { select(b.el); scrollToLive(b.el); } }, h("b", { text: nm[0] })),
        h("span", { class: "acts" },
          b.movable ? h("button", { class: "btn icon sm ghost", title: "Feljebb", "aria-label": "Feljebb", onclick: function () { var i = movables.indexOf(b.el); if (i > 0) moveBlock(b.el, movables[i - 1]); } }, "↑") : null,
          b.movable ? h("button", { class: "btn icon sm ghost", title: "Lejjebb", "aria-label": "Lejjebb", onclick: function () { var i = movables.indexOf(b.el); if (i < movables.length - 1) moveBlock(b.el, nextAfter(movables[i + 1])); } }, "↓") : null,
          h("button", { class: "btn icon sm ghost", title: off ? "Megjelenítés" : "Elrejtés", "aria-label": off ? "Megjelenítés" : "Elrejtés", onclick: function () { toggleOff(b.el); } }, off ? "◌" : "👁")));
      if (b.movable) {
        li.addEventListener("dragstart", function (e) { S.drag = b.el; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x"); });
        li.addEventListener("dragend", function () { S.drag = null; li.classList.remove("dragging"); clearDrop(); });
        li.addEventListener("dragover", function (e) {
          if (!S.drag || S.drag === b.el) return;
          e.preventDefault(); clearDrop();
          var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
          li.classList.add(after ? "drop-after" : "drop-before"); li._after = after;
        });
        li.addEventListener("drop", function (e) {
          e.preventDefault();
          if (!S.drag || S.drag === b.el) return;
          var target = li._after ? nextAfter(b.el) : b.el;
          moveBlock(S.drag, target);
        });
      }
      ul.append(li);
    });

    // Ausgeblendete Einzelelemente (nicht Sektionen)
    var he = $("hiddenEls"); he.innerHTML = "";
    var blockEls = list.map(function (b) { return b.el; });
    var hid = Array.prototype.filter.call(p.doc.querySelectorAll("[data-mk-off]"), function (x) { return blockEls.indexOf(x) < 0; });
    if (hid.length) {
      he.append(h("div", { class: "sec-title", text: "Elrejtett elemek" }));
      he.append(h("ul", { class: "blocks" }, hid.map(function (x) {
        var t = x.textContent.replace(/\s+/g, " ").trim().slice(0, 50) || (x.tagName === "IMG" ? "Kép: " + (x.getAttribute("alt") || x.getAttribute("src")) : x.tagName.toLowerCase());
        return h("li", { class: "blk off" }, h("span", { class: "blk-name", onclick: function () { select(x); } }, h("b", { text: t })),
          h("button", { class: "btn sm", onclick: function () { toggleOff(x); }, text: "Megjelenítés" }));
      })));
    }
  }
  function nextAfter(el) { var n = el.nextElementSibling; return n; }
  function clearDrop() { Array.prototype.forEach.call(document.querySelectorAll(".drop-before,.drop-after"), function (x) { x.classList.remove("drop-before", "drop-after"); }); }

  // ------------------------------------------------------------ Inspektor
  var isTexty = E.isTexty;
  function frameI18N() { try { return frame.contentWindow.I18N || null; } catch (e) { return null; } }
  function frameLang() { var d = fdoc(); return d ? (d.documentElement.lang || "de").slice(0, 2) : "de"; }

  function field(label, input, hint) { return h("label", { class: "f" }, h("span", null, label), input, hint ? h("span", { class: "hint", text: hint }) : null); }

  function renderInspector() {
    var box = $("insp"); box.innerHTML = "";
    var el = S.sel, p = curPage();
    if (!el || !p || !p.doc.contains(el)) { S.sel = null; return; }
    var keyed = el.getAttribute("data-i18n") || el.getAttribute("data-i18n-html");
    var desc = el.tagName === "IMG" ? "Kép" : el.tagName === "A" ? "Link / gomb" : (keyed || isTexty(el)) ? "Szöveg" : "Terület";
    var parent = el.parentElement && !/^(BODY|HTML)$/.test(el.parentElement.tagName) ? el.parentElement : null;
    var off = el.hasAttribute("data-mk-off");
    var wrap = h("div", { class: "insp" },
      h("div", { class: "crumb" }, h("b", { class: "kind", text: desc }),
        parent ? h("button", { class: "btn sm ghost", onclick: function () { select(parent); }, text: "↖ Szülő elem" }) : null,
        h("button", { class: "btn sm ghost", onclick: function () { scrollToLive(el); }, text: "Mutasd" }),
        h("button", { class: "btn sm ghost", onclick: function () { toggleOff(el); }, text: off ? "Megjelenítés" : "Elrejtés" }),
        h("span", { style: "flex:1" }),
        h("button", { class: "btn sm icon ghost", "aria-label": "Bezárás", onclick: function () { S.sel = null; markSel(); renderInspector(); } }, "✕")));

    var key = el.getAttribute("data-i18n") || el.getAttribute("data-i18n-html");
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
      S.unlocked = S.unlocked || {};
      var auto = !!S.translate; // ohne DeepL-Schlüssel: alle Sprachen frei bearbeitbar
      var locked = function (l) { return auto && !S.unlocked[key + "|" + l]; };
      var status = h("p", { class: "hint tr-status" });
      var setStatus = function (st, msg) {
        status.className = "hint tr-status " + (auto ? st : "soon");
        status.textContent = !auto ? t("A többi nyelvet egyelőre kézzel kell beírni – az automatikus fordítás hamarosan érkezik.")
          : st === "busy" || st === "wait" ? t("Fordítás…") : st === "error" ? t("A fordítás nem sikerült: ") + msg
          : others.some(locked) ? t("🔒 A többi nyelv automatikusan fordul a német szövegből.") : "";
      };
      var translate = E.autoTranslator(function (l, txt) {
        if (!locked(l)) return;
        setI18n(el, key, l, txt);
        if (tas[l]) tas[l].value = txt;
      }, setStatus);
      var rows = function (n) { return Math.min(6, Math.max(2, Math.ceil(String(n).length / 42))); };
      wrap.append(h("p", { class: "hint", style: "margin:0 0 10px", text: "Többnyelvű szöveg" }));
      var deVal = valOf("de"), de = E.richField();
      de.value = deVal;
      de.addEventListener("input", function () { var v = de.value; setI18n(el, key, "de", v); if (auto) translate(v, others.filter(locked)); });
      wrap.append(h("label", { class: "f" }, h("span", null, h("span", { class: "lang-tag", text: "DE" }), "Német (alap)"), de));
      if (others.length) wrap.append(status);
      others.forEach(function (l) {
        var cur = valOf(l), ta = E.richField();
        ta.value = cur; tas[l] = ta;
        var btn = h("button", { class: "btn sm ghost" + (auto ? "" : " hidden"), type: "button" });
        var paint = function () {
          var lk = locked(l);
          ta.readOnly = lk; ta.classList.toggle("locked", lk);
          btn.textContent = lk ? t("🔒 Feloldás") : t("Automatikus");
        };
        btn.onclick = function () {
          var k = key + "|" + l;
          if (S.unlocked[k]) { delete S.unlocked[k]; translate(de.value, [l], true); } else { S.unlocked[k] = true; ta.focus(); }
          paint(); setStatus("idle");
        };
        ta.addEventListener("input", function () { if (!locked(l)) setI18n(el, key, l, ta.value); });
        paint();
        wrap.append(h("div", { class: "f" }, h("div", { class: "tr-head" }, h("span", null, h("span", { class: "lang-tag", text: l.toUpperCase() })), btn), ta));
      });
      setStatus("idle");
    } else if (isTexty(el)) {
      var hasTags = el.children.length > 0;
      var ta = hasTags ? E.richField() : h("textarea", { class: "inp", rows: 3 });
      ta.value = hasTags ? el.innerHTML.trim() : el.textContent.trim();
      ta.addEventListener("input", function () {
        var v = ta.value;
        if (hasTags) el.innerHTML = v; else el.textContent = v;
        var l = live(el);
        if (l) { if (hasTags) l.innerHTML = v; else l.textContent = v; }
        changed();
      });
      wrap.append(field("Szöveg", ta));
    } else if (el.tagName !== "IMG" && el.tagName !== "A") {
      wrap.append(h("p", { class: "hint", style: "margin:0" }, "Ez egy tároló elem. Kattints az előnézetben egy konkrét szövegre, képre vagy linkre a szerkesztéshez."));
    }

    var a = el.tagName === "A" ? el : null;
    if (a) {
      var href = h("input", { class: "inp", value: a.getAttribute("href") || "" });
      href.addEventListener("input", function () { setAttr(a, "href", href.value); });
      var nt = h("input", { type: "checkbox" }); nt.checked = a.getAttribute("target") === "_blank";
      nt.addEventListener("change", function () {
        setAttr(a, "target", nt.checked ? "_blank" : null);
        setAttr(a, "rel", nt.checked ? "noopener" : null);
      });
      wrap.append(field("Link címe", href, "pl. https://…, tel:+43…, mailto:…, #szekcio"),
        h("label", { class: "switch small", style: "margin-bottom:12px" }, nt, h("span", { class: "tr" }), "Új lapon nyíljon"));
      if (!key && !isTexty(a) && a.textContent.trim() === "") wrap.append(h("p", { class: "hint", text: "A link szövegét a benne lévő elemre kattintva szerkesztheted." }));
    }

    if (el.tagName === "IMG") {
      var l = live(el);
      wrap.append(h("img", { class: "thumb", src: l ? (l.currentSrc || l.src) : "", alt: "" }));
      var fi = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif" });
      fi.addEventListener("change", function () { if (fi.files[0]) replaceImage(el, fi.files[0]); });
      var alt = h("input", { class: "inp", value: el.getAttribute("alt") || "" });
      alt.addEventListener("input", function () { setAttr(el, "alt", alt.value); });
      wrap.append(field("Kép cseréje", fi, "JPG/PNG/WebP. A nagy képeket automatikusan kicsinyítjük."), field("Alternatív szöveg (alt)", alt, "Google és képernyőolvasók számára."));
    }
    box.append(wrap);
  }

  function setAttr(el, name, val) {
    var l = live(el);
    [el, l].forEach(function (x) { if (!x) return; if (val == null) x.removeAttribute(name); else x.setAttribute(name, val); });
    changed();
  }
  function setI18n(el, key, lang, val) {
    var p = curPage();
    (p.overrides[lang] = p.overrides[lang] || {})[key] = val;
    if (lang === "de") el.innerHTML = val;
    var I = frameI18N();
    if (I) (I[lang] = I[lang] || {})[key] = val;
    if (frameLang() === lang) { var l = live(el); if (l) l.innerHTML = val; }
    ensureOverridesTag(p.doc);
    changed();
  }

  function replaceImage(el, file) {
    var p = curPage();
    E.readImage(file, IMG_MSG).then(function (r) {
      var name = E.uploadName(file, r.ext);
      p.uploads.push({ path: name, data: r.dataUrl.split(",")[1], dataUrl: r.dataUrl });
      el.setAttribute("src", name); el.removeAttribute("srcset"); el.removeAttribute("sizes");
      var l = live(el);
      if (l) { l.removeAttribute("srcset"); l.removeAttribute("sizes"); l.setAttribute("src", r.dataUrl); }
      changed(); renderInspector();
    }).catch(function (e) { toast(e.message, true); });
  }
  var IMG_MSG = { type: t("Csak JPG, PNG, WebP vagy GIF tölthető fel."), read: t("A kép nem olvasható."), size: t("A kép túl nagy (max. 3 MB).") };

  // ------------------------------------------------------------ Einstellungen
  function validateSite(s) {
    var errs = {};
    if (!s.folder) return errs;
    if (!NAME_RE.test(s.slug)) errs.slug = "Csak kisbetű, szám és kötőjel (a–z, 0–9, -).";
    else if (RESERVED.indexOf(s.slug) >= 0) errs.slug = "Ez a cím foglalt.";
    else S.config.sites.forEach(function (o) {
      if (o.id !== s.id && (o.slug === s.slug || (o.aliases || []).indexOf(s.slug) >= 0)) errs.slug = "Már használja: " + o.name;
    });
    if (s.subdomain) {
      if (!NAME_RE.test(s.subdomain) || s.subdomain === "www") errs.subdomain = "Csak kisbetű, szám és kötőjel.";
      else S.config.sites.forEach(function (o) { if (o.id !== s.id && o.subdomain === s.subdomain) errs.subdomain = "Már használja: " + o.name; });
    }
    return errs;
  }
  function allValid() { return S.config.sites.every(function (s) { return !Object.keys(validateSite(s)).length; }); }

  function card(title, sub) {
    var body = h("div", { class: "scard-body" });
    var el = h("section", { class: "scard" }, h("header", null, h("h4", { text: title }), sub ? h("p", { class: "hint", text: sub }) : null), body);
    el.body = body;
    return el;
  }

  function renderSettings() {
    var box = $("tabSettings"); box.innerHTML = "";
    var s = siteById(S.cur); if (!s) return;
    var b = baseSite(s.id), isMain = !s.folder;
    var errs = validateSite(s);

    function inp(key, attrs) {
      var i = h("input", Object.assign({ class: "inp" + (errs[key] ? " err" : ""), value: s[key] || "" }, attrs || {}));
      i.addEventListener("input", function () {
        s[key] = attrs && attrs.lower ? i.value.toLowerCase().trim() : i.value;
        changed(); var e2 = validateSite(s);
        i.classList.toggle("err", !!e2[key]);
        var et = box.querySelector('[data-err="' + key + '"]'); if (et) et.textContent = t(e2[key] || "");
        renderSide(); renderHead();
      });
      return i;
    }

    // --- Állapot
    var en = h("input", { type: "checkbox" }); en.checked = !!s.enabled; en.disabled = isMain;
    en.addEventListener("change", function () {
      if (en.checked && !(b && b.enabled) && impNeeded(s)) {
        en.checked = false; toast(t("Előbb töltsd ki az impresszumot – enélkül az oldal nem kapcsolható be."), true);
        var ic = box.querySelector(".imp-card"); if (ic) ic.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      s.enabled = en.checked; changed(); renderSettings();
    });
    box.append(h("section", { class: "scard status-card" + (s.enabled ? " on" : "") },
      h("div", null, h("b", { text: s.enabled ? "Az oldal online" : "Az oldal ki van kapcsolva" }),
        h("div", { class: "hint", text: isMain ? "A főoldal mindig online." : s.enabled ? "Bárki elérheti a címén." : "A látogatók egy „nem elérhető” oldalt látnak. Az NFC-kártya linkje nem változik." })),
      h("label", { class: "switch" }, en, h("span", { class: "tr" }))));

    // --- Alapadatok
    var basic = card("Alapadatok");
    basic.body.append(field("Név (csak az adminban látszik)", inp("name")));
    var sel = h("select", { class: "inp" }, allGroups().map(function (g) { var o = h("option", { value: g, text: g }); if (g === s.group) o.selected = true; return o; }),
      h("option", { value: "__new", text: "+ Új csoport…" }));
    sel.addEventListener("change", function () {
      if (sel.value !== "__new") { s.group = sel.value; changed(); return; }
      newGroup().then(function (n) { if (n) { s.group = n; changed(); } renderSettings(); });
    });
    basic.body.append(field("Csoport", sel, "Csoportot a bal oldali listában is válthatsz: húzd a munkát a csoport fölé."));
    box.append(basic);

    box.append(renderFeatures(s));
    if (featOn(s, "impressum")) box.append(renderImpressum(s, b));

    if (!isMain) {
      // --- Cím
      var addr = card("Cím és domain", "A régi címek közzététel után automatikusan átirányítanak, így a kiadott NFC-kártyák mindig működnek.");
      addr.body.append(h("label", { class: "f" }, h("span", null, "Cím a meinekontaktkarte.com alatt"),
        h("div", { class: "affix" }, h("span", { class: "fx", text: ROOT_DOMAIN + "/" }), inp("slug", { lower: true, spellcheck: "false", autocapitalize: "off" }), h("span", { class: "fx", text: "/" })),
        h("span", { class: "err-text", "data-err": "slug", text: errs.slug || "" })));
      if (b && b.slug && b.slug !== s.slug) addr.body.append(h("p", { class: "hint", style: "margin:-6px 0 14px;color:var(--ok)" }, "✓ A régi cím (/" + b.slug + ") közzététel után átirányít ide."));
      addr.body.append(h("label", { class: "f" }, h("span", null, "Aldomain (opcionális)"),
        h("div", { class: "affix" }, inp("subdomain", { lower: true, spellcheck: "false", autocapitalize: "off", placeholder: "pl. caribik" }), h("span", { class: "fx", text: "." + ROOT_DOMAIN })),
        h("span", { class: "err-text", "data-err": "subdomain", text: errs.subdomain || "" }),
        h("span", { class: "hint", text: "Egyszeri beállítás kell hozzá a Vercelben (*." + ROOT_DOMAIN + " wildcard domain), lásd ADMIN.md." })));
      if ((s.aliases || []).length) {
        addr.body.append(h("div", { class: "sec-title", text: "Régi címek (átirányítanak ide)" }));
        addr.body.append(h("ul", { class: "hist" }, s.aliases.map(function (al) {
          return h("li", null, h("span", { class: "t" }, h("b", { text: ROOT_DOMAIN + "/" + al })),
            h("button", { class: "btn sm danger", text: "Törlés", onclick: function () {
              ask("Átirányítás törlése?", "Ha van kint NFC-kártya ezzel a címmel (/" + al + "), az utána nem fog működni.", "Törlés", true).then(function (y) {
                if (!y) return; s.aliases = s.aliases.filter(function (x) { return x !== al; }); changed(); renderSettings();
              });
            } }));
        })));
      }
      addr.body.append(h("p", { class: "hint", style: "margin:4px 0 0" }, "Mappa a repóban: ", h("code", { text: s.folder })));
      box.append(addr);

      // --- Ügyfél-admin
      box.append(renderClientAdmins(s, b));

      // --- Arculat
      if (featOn(s, "brand")) box.append(renderBrand(s));

      // --- GitHub
      if (featOn(s, "repo")) {
      var gh = card("Saját GitHub-repó", "Minden mentés (a tiéd és az ügyfélé is) ide is bekerül: a weboldal mappájának tartalma.");
      var ri = h("input", { class: "inp", value: s.repo || "", placeholder: "66Kilian/LoveKinoADMIN", spellcheck: "false", autocapitalize: "off" });
      ri.addEventListener("input", function () { s.repo = ri.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""); changed(); });
      gh.body.append(field("Repó (tulajdonos/név)", ri, "A GitHub-tokennek ehhez a repóhoz is kell írási jog."));
      if (b && b.repo) gh.body.append(h("div", { class: "row-l" },
        h("a", { class: "btn sm ghost", href: "https://github.com/" + b.repo, target: "_blank", rel: "noopener", text: "Megnyitás ↗" }),
        h("button", { class: "btn sm", text: "Teljes szinkron most", onclick: function (e) {
          var btn = e.target; btn.disabled = true;
          api("clients", { action: "sync", site: s.id }).then(function () { toast("Szinkronizálva → " + b.repo + " ✓"); })
            .catch(function (err) { toast(err.message, true); }).finally(function () { btn.disabled = false; });
        } })));
      box.append(gh);
      }
    }

    // --- Jegyzet
    var nc = card("Belső jegyzet", "Csak te látod: ügyfél, határidő, számla, teendők …");
    var notes = h("textarea", { class: "inp", rows: 5 }); notes.value = s.notes || "";
    notes.addEventListener("input", function () { s.notes = notes.value; changed(); });
    nc.body.append(notes);
    box.append(nc);

    if (!b) {
      box.append(h("button", { class: "btn danger sm", text: "Felvétel visszavonása", onclick: function () {
        S.config.sites = S.config.sites.filter(function (x) { return x.id !== s.id; });
        delete S.pages[s.id]; changed(); openSite(S.config.sites[0].id);
      } }));
    }
  }

  // ------------------------------------------------------------ Kunden-Admins
  function clientAdminUrl(s) { return "https://" + ROOT_DOMAIN + "/" + s.slug + "/admin/"; }
  function genPassword() {
    var a = "abcdefghjkmnpqrstuvwxyz23456789", r = crypto.getRandomValues(new Uint8Array(12)), out = "";
    for (var i = 0; i < 12; i++) { out += a[r[i] % a.length]; if (i === 3 || i === 7) out += "-"; }
    return out;
  }
  function userFromName(n) { return n.trim() ? slugify(n).replace(/-/g, ".").slice(0, 30) : ""; }
  function initials(n) { return String(n).trim().split(/\s+/).slice(0, 2).map(function (x) { return x[0] || ""; }).join("").toUpperCase(); }

  // Ein Satz Aktionen + Zeilen für die Kunden-Admins einer Seite (Einstellungen und Übersicht nutzen ihn).
  function clientTools(s, onView) {
    function act(data) {
      data.site = s.id;
      return api("clients", data).then(function (v) { S.counts = S.counts || {}; S.counts[s.id] = v.accounts.length; renderSide(); onView(v); return v; });
    }
    function errToast(e) { toast(e.message, true); }
    function row(a) {
      var meta = h("small", null, "@" + a.username + " · ",
        h("span", { class: a.totp ? "ok-t" : "muted", text: a.totp ? "2FA ✓" : "2FA nincs" }),
        " · " + (a.lastLogin ? t("utoljára belépett: ") + fmtDate(a.lastLogin) : t("még nem lépett be")));
      return h("div", { class: "acc" + (a.disabled ? " disabled" : "") },
        h("span", { class: "avatar", text: initials(a.name) }),
        h("div", { class: "acc-t" }, h("b", null, a.name, a.disabled ? h("span", { class: "pill off", style: "margin-left:6px", text: "Letiltva" }) : null), meta),
        h("div", { class: "acc-acts" },
          h("button", { class: "btn sm", text: "Új jelszó", onclick: function () { setPassword(a); } }),
          h("details", { class: "more-menu" }, h("summary", { class: "btn sm icon", "aria-label": "Továbbiak" }, "⋯"),
            h("div", { class: "menu" },
              h("button", { text: "Szerkesztés (név, felhasználónév)", onclick: function () { editAccount(a); } }),
              h("button", { text: "Jelszó-visszaállító link", onclick: function () { act({ action: "reset", account: a.id }).then(function (v2) { showLink("Jelszó-visszaállító link", v2.link, s, a.name); }).catch(errToast); } }),
              a.totp ? h("button", { text: "2FA törlése", onclick: function () {
                ask("2FA törlése?", a.name + " legközelebb csak jelszóval lép be, és újra bekapcsolhatja.", "Törlés", true).then(function (y) { if (y) act({ action: "reset2fa", account: a.id }).then(function () { toast("2FA törölve ✓"); }).catch(errToast); });
              } }) : null,
              a.disabled
                ? h("button", { text: "Engedélyezés", onclick: function () { act({ action: "enable", account: a.id }).then(function () { toast(a.name + ": " + t("újra be tud lépni ✓")); }).catch(errToast); } })
                : h("button", { text: "Letiltás (ideiglenesen)", onclick: function () {
                  ask("Fiók letiltása?", a.name + " azonnal kilép, és amíg újra nem engedélyezed, nem tud belépni. A fiók és az adatai megmaradnak.", "Letiltás", true).then(function (y) { if (y) act({ action: "disable", account: a.id }).then(function () { toast("Letiltva ✓"); }).catch(errToast); });
                } }),
              h("button", { class: "danger", text: "Fiók törlése", onclick: function () {
                ask("Ügyfél-admin törlése?", a.name + " (@" + a.username + ") nem tud többé belépni.", "Törlés", true).then(function (y) { if (y) act({ action: "delete", account: a.id }).catch(errToast); });
              } })))));
    }
    function inviteRow(i) {
      return h("div", { class: "acc pending" },
        h("span", { class: "avatar", text: "…" }),
        h("div", { class: "acc-t" }, h("b", { text: (i.kind === "reset" ? "Jelszó-link" : "Meghívó") + (i.name ? ": " + i.name : "") }), h("small", { text: "még nem használt · lejár: " + fmtDate(new Date(i.exp).toISOString()) })),
        h("div", { class: "acc-acts" }, h("button", { class: "btn sm", text: "Visszavonás", onclick: function () { act({ action: "revoke", invite: i.id }).catch(errToast); } })));
    }
    function accountForm(a, withPw) {
      var name = h("input", { class: "inp", value: a ? a.name : "", placeholder: "pl. Marcus Waikat", autocomplete: "off" });
      var user = h("input", { class: "inp", value: a ? a.username : "", placeholder: "pl. marcus", spellcheck: "false", autocapitalize: "off", autocomplete: "off" });
      var touched = !!a;
      user.addEventListener("input", function () { touched = true; });
      name.addEventListener("input", function () { if (!touched) user.value = userFromName(name.value); });
      var pw = withPw ? h("input", { class: "inp mono", value: genPassword(), spellcheck: "false", autocomplete: "off" }) : null;
      var form = h("div", null, field("Név", name, "Így szólítja meg az admin, és ez látszik nálad a listában."), field("Felhasználónév", user, "Ezzel lép be. Kisbetű, szám, pont, kötőjel."),
        withPw ? h("label", { class: "f" }, h("span", null, "Jelszó"), h("div", { class: "row-l" }, pw, h("button", { class: "btn sm", type: "button", text: "Új", onclick: function () { pw.value = genPassword(); } })),
          h("span", { class: "hint", text: "Legalább 10 karakter. Belépés után az ügyfél megváltoztathatja." })) : null,
        h("p", { class: "err-text", "data-err": "acc" }));
      setTimeout(function () { (a ? user : name).focus(); }, 30);
      return { el: form, name: name, user: user, pw: pw, err: form.querySelector("[data-err]") };
    }
    // Dialog, der bei Fehlern offen bleibt
    function formDialog(title, f, yes, run) {
      return new Promise(function (resolve) {
        ask(title, f.el, yes).then(function (y) {
          if (!y) return resolve(null);
          run().then(resolve).catch(function (e) {
            f.err.textContent = t(e.message);
            formDialog(title, f, yes, run).then(resolve);
          });
        });
      });
    }
    function create() {
      var f = accountForm(null, true);
      formDialog("Ügyfél-admin létrehozása · " + s.name, f, "Létrehozás", function () {
        return act({ action: "create", name: f.name.value, username: f.user.value, password: f.pw.value });
      }).then(function (v) { if (v) showCredentials(s, f.name.value.trim(), f.user.value.trim().toLowerCase(), f.pw.value); });
    }
    function invite() {
      var name = h("input", { class: "inp", placeholder: "pl. Marcus (opcionális)" });
      ask("Meghívó link · " + s.name, h("div", null, h("p", { class: "muted", text: "Az ügyfél a linken maga adja meg a felhasználónevét és jelszavát. 7 napig érvényes, egyszer használható." }),
        field("Név (előre kitöltve, opcionális)", name)), "Link létrehozása").then(function (y) {
        if (!y) return;
        act({ action: "invite", name: name.value }).then(function (v) { showLink("Meghívó link", v.link, s, name.value.trim()); }).catch(errToast);
      });
    }
    function editAccount(a) {
      var f = accountForm(a, false);
      formDialog("Fiók szerkesztése", f, "Mentés", function () { return act({ action: "update", account: a.id, name: f.name.value, username: f.user.value }); })
        .then(function (v) { if (v) toast("Mentve ✓"); });
    }
    function setPassword(a) {
      var pw = h("input", { class: "inp mono", value: genPassword(), spellcheck: "false" });
      var f = { el: h("div", null, h("p", { class: "muted", text: a.name + " új jelszava. Minden eszközről kilépteti." }), h("label", { class: "f" }, h("span", null, "Új jelszó"), h("div", { class: "row-l" }, pw, h("button", { class: "btn sm", type: "button", text: "Új", onclick: function () { pw.value = genPassword(); } }))), h("p", { class: "err-text" })) };
      f.err = f.el.querySelector(".err-text");
      formDialog("Új jelszó", f, "Beállítás", function () { return act({ action: "setpw", account: a.id, password: pw.value }); })
        .then(function (v) { if (v) showCredentials(s, a.name, a.username, pw.value); });
    }
    return { act: act, row: row, inviteRow: inviteRow, create: create, invite: invite };
  }

  // ------------------------------------------------------------ Übersicht aller Kunden-Admins
  function openClients() {
    S.clientsView = true;
    $("vClients").classList.remove("hidden");
    $("btnClients").classList.add("on");
    renderClients();
  }
  function closeClients() {
    S.clientsView = false;
    $("vClients").classList.add("hidden");
    $("btnClients").classList.remove("on");
  }
  function renderClients() {
    var box = $("vClients"); box.innerHTML = "";
    var q = h("input", { class: "inp", type: "search", placeholder: "Keresés: név, felhasználónév, oldal…" });
    var onlyOff = h("input", { type: "checkbox" });
    var list = h("div", { class: "cv-list" }, h("div", { class: "spin" }));
    box.append(h("div", { class: "cv-head" },
      h("div", null, h("h2", { text: "Ügyfél-adminok" }), h("p", { class: "hint", text: "Minden oldal összes ügyfél-admin fiókja. Új jelszó, visszaállító link, 2FA törlése, letiltás és törlés – egy helyen." })),
      h("button", { class: "btn sm", text: "Bezárás", onclick: closeClients })),
      h("div", { class: "cv-tools" }, q, h("label", { class: "cv-chk" }, onlyOff, h("span", { text: "Csak letiltottak" }))),
      list);
    var data = null;
    function paint() {
      list.innerHTML = "";
      var term = q.value.trim().toLowerCase(), total = 0;
      data.sites.forEach(function (g) {
        var s = siteById(g.site.id) || g.site;
        var accs = g.accounts.filter(function (a) {
          if (onlyOff.checked && !a.disabled) return false;
          return !term || (a.name + " " + a.username + " " + g.site.name + " " + g.site.slug).toLowerCase().indexOf(term) >= 0;
        });
        var invs = term || onlyOff.checked ? [] : g.invites;
        if ((term || onlyOff.checked) && !accs.length) return;
        total += accs.length;
        var tools = clientTools(s, function (v) { g.accounts = v.accounts; g.invites = v.invites; paint(); });
        var sec = h("section", { class: "scard cv-site" },
          h("header", null,
            h("div", { class: "row-l" },
              h("h4", { text: g.site.name }),
              h("span", { class: "pill " + (g.site.clientAdmin ? "ok" : "off"), text: g.site.clientAdmin ? "Ügyfél-admin be" : "Ügyfél-admin ki" }),
              h("span", { class: "grow", style: "flex:1" }),
              h("button", { class: "btn sm ghost", text: "Oldal beállításai", onclick: function () { closeClients(); openSite(g.site.id); setTab("settings"); } }))),
          h("div", { class: "scard-body" },
            h("div", { class: "acc-list" }, accs.map(tools.row), invs.map(tools.inviteRow),
              !accs.length && !invs.length ? h("p", { class: "hint", style: "margin:0", text: "Még nincs ügyfél-admin." }) : null),
            !term && !onlyOff.checked ? h("div", { class: "row-l", style: "margin-top:10px" },
              h("button", { class: "btn sm", text: "+ Admin létrehozása", onclick: tools.create }),
              h("button", { class: "btn sm ghost", text: "Meghívó link", onclick: tools.invite })) : null));
        list.append(sec);
      });
      if (!list.children.length) list.append(h("p", { class: "hint", text: term || onlyOff.checked ? "Nincs találat." : "Még nincs egy oldal sem." }));
    }
    q.addEventListener("input", function () { if (data) paint(); });
    onlyOff.addEventListener("change", function () { if (data) paint(); });
    api("clients?all=1").then(function (d) { data = d; paint(); q.focus(); }).catch(function (e) { list.innerHTML = ""; list.append(h("p", { class: "err-text", text: e.message })); });
  }

  function renderClientAdmins(s, b) {
    var c = card("Ügyfél-adminok", "Az ügyfél a saját, márkázott adminjában szerkesztheti az oldalát. Mentéskor azonnal élesedik.");
    if (!b) { c.body.append(h("p", { class: "hint", text: "Közzététel után hozhatsz létre ügyfél-admint." })); return c; }
    // Schalter: ohne Freischaltung gibt es /<slug>/admin/ nicht (404)
    var ca = h("input", { type: "checkbox" }); ca.checked = !!s.clientAdmin;
    var caT = h("b"), caH = h("div", { class: "hint" });
    var paintCa = function () {
      caT.textContent = t(s.clientAdmin ? "Ügyfél-admin bekapcsolva" : "Ügyfél-admin kikapcsolva");
      caH.textContent = t(s.clientAdmin ? "Az ügyfél be tud lépni a saját adminjába." : "A …/admin/ cím nem létezik (404), amíg be nem kapcsolod.")
        + (!!s.clientAdmin !== !!b.clientAdmin ? " " + t("Közzététel után lép életbe.") : "");
    };
    ca.addEventListener("change", function () { s.clientAdmin = ca.checked; paintCa(); changed(); });
    paintCa();
    c.body.append(h("div", { class: "toggle-row" }, h("div", null, caT, caH), h("label", { class: "switch" }, ca, h("span", { class: "tr" }))));
    var url = clientAdminUrl(b);
    c.body.append(h("div", { class: "url-row" },
      h("a", { href: url, target: "_blank", rel: "noopener", text: url.replace("https://", "") + " ↗" }),
      h("button", { class: "btn sm ghost", text: "Másolás", onclick: function () { navigator.clipboard.writeText(url).then(function () { toast("Kimásolva ✓"); }); } })));
    var wrap = h("div", { class: "clients" }, h("div", { class: "spin" }));
    c.body.append(wrap);
    var tools = clientTools(s, function (v) { draw(v); });
    function draw(v) {
      wrap.innerHTML = "";
      var list = h("div", { class: "acc-list" });
      v.accounts.forEach(function (a) { list.append(tools.row(a)); });
      v.invites.forEach(function (i) { list.append(tools.inviteRow(i)); });
      if (!v.accounts.length && !v.invites.length) list.append(h("p", { class: "hint", style: "margin:0 0 4px", text: "Még nincs ügyfél-admin ennél az oldalnál." }));
      wrap.append(list, h("div", { class: "row-l", style: "margin-top:12px" },
        h("button", { class: "btn primary sm", text: "+ Admin létrehozása", onclick: tools.create }),
        h("button", { class: "btn sm", text: "Meghívó link küldése", onclick: tools.invite }),
        h("button", { class: "btn sm ghost", text: "Összes ügyfél-admin", onclick: openClients })));
    }
    api("clients?site=" + encodeURIComponent(s.id)).then(draw).catch(function (e) { wrap.innerHTML = ""; wrap.append(h("p", { class: "err-text", text: e.message })); });
    return c;
  }

  function copyBtn(text, label) {
    return h("button", { class: "btn sm", type: "button", text: label || "Másolás", onclick: function () { navigator.clipboard.writeText(text).then(function () { toast("Kimásolva ✓"); }); } });
  }
  function showCredentials(s, name, user, pw) {
    var url = clientAdminUrl(s);
    var msg = "Hallo " + name + "! Dein Zugang zum Website-Admin von " + s.name + ":\n" + url + "\nBenutzername: " + user + "\nPasswort: " + pw + "\n\nBitte ändere das Passwort nach dem ersten Login (Einstellungen → Passwort ändern).";
    ask("Belépési adatok", h("div", null,
      h("p", { class: "muted", text: "Küldd el az ügyfélnek. A jelszót később már nem látod (csak újat adhatsz)." }),
      h("div", { class: "cred" },
        h("span", { text: "Cím" }), h("code", { text: url }),
        h("span", { text: "Felhasználónév" }), h("code", { text: user }),
        h("span", { text: "Jelszó" }), h("code", { text: pw })),
      h("div", { class: "row-l", style: "margin-top:12px" }, copyBtn(msg, "Minden másolása"),
        h("a", { class: "btn sm", href: "https://wa.me/?text=" + encodeURIComponent(msg), target: "_blank", rel: "noopener", text: "Küldés WhatsAppon" }))), null);
  }
  function showLink(title, link, s, name) {
    var msg = "Hallo" + (name ? " " + name : "") + "! Hier ist der Zugang zu deinem Website-Admin für " + s.name + ": " + link + " (Link gilt 7 Tage)";
    ask(title, h("div", null,
      h("p", { class: "muted", text: "Küldd el ezt a linket az ügyfélnek. 7 napig érvényes, egyszer használható." }),
      h("input", { class: "inp", value: link, readonly: true }),
      h("div", { class: "row-l", style: "margin-top:10px" }, copyBtn(link),
        h("a", { class: "btn sm", href: "https://wa.me/?text=" + encodeURIComponent(msg), target: "_blank", rel: "noopener", text: "Küldés WhatsAppon" }))), null);
  }

  // ------------------------------------------------------------ Funktionen je Seite
  var FEATURES = [
    ["impressum", "Impresszum", "Saját „Impressum” oldal (…/impressum/), kötelező adatokkal. Kikapcsolva nincs ilyen oldal, és nem kell kitölteni."],
    ["repo", "Saját GitHub-repó", "Minden mentés a weboldal saját repójába is bekerül."],
    ["brand", "Ügyfél-admin arculata", "Az ügyfél-admin színeit, logóját itt felülírhatod."],
    ["clientSections", "Ügyfél: szekciók", "Az ügyfél átrendezheti, elrejtheti a szekciókat."],
    ["clientDesign", "Ügyfél: design-választó", "Az ügyfél másik színdesignt választhat."]
  ];
  function renderFeatures(s) {
    var c = card("Funkciók ennél az oldalnál", "Csak az jelenjen meg, amire ennek az ügyfélnek szüksége van. Kikapcsolva a hozzá tartozó beállítások is eltűnnek.");
    var list = h("div", { class: "feat-list" });
    FEATURES.forEach(function (f) {
      if (!s.folder && f[0] !== "impressum") return; // Startseite: nur Impressum
      var i = h("input", { type: "checkbox" }); i.checked = featOn(s, f[0]);
      i.addEventListener("change", function () {
        s.features = s.features || {};
        if (i.checked) delete s.features[f[0]]; else s.features[f[0]] = false;
        changed(); renderSettings(); renderSide();
      });
      list.append(h("label", { class: "feat" }, h("span", { class: "feat-t" }, h("b", { text: f[1] }), h("small", { text: f[2] })), h("span", { class: "switch" }, i, h("span", { class: "tr" }))));
    });
    c.body.append(list);
    return c;
  }

  // ------------------------------------------------------------ Impressum
  function renderImpressum(s, b) {
    s.impressum = s.impressum || {};
    var o = s.impressum, miss = impMissing(o);
    var c = card("Impresszum", "Ausztriában kötelező (ECG § 5, UGB § 14, GewO § 63, MedienG § 25). Ebből készül az oldal „Impressum” lapja, a lábléc linkje automatikusan odamutat.");
    c.classList.add("imp-card");
    var state = h("div", { class: "toggle-row imp-state" + (miss.length ? " bad" : " ok") });
    function paintState() {
      miss = impMissing(o); state.innerHTML = "";
      state.className = "toggle-row imp-state" + (miss.length ? " bad" : " ok");
      var open = b && !miss.length && b.impressum && JSON.stringify(b.impressum) === JSON.stringify(o);
      state.append(h("div", null,
        h("b", { text: miss.length ? "Hiányos – " + miss.length + " kötelező mező üres" : "Kész – minden kötelező adat megvan" }),
        h("div", { class: "hint", text: miss.length ? (s.enabled ? "Az oldal online, de az impresszum hiányos. Töltsd ki minél előbb." : "Amíg hiányos, az oldal nem kapcsolható be.") : (b && b.impressum && JSON.stringify(b.impressum) === JSON.stringify(o) ? "Élesben: " + impUrl(b) : "Közzététel után lesz élesben.") })),
        "");
      if (open) state.append(h("a", { class: "btn sm ghost", href: impUrl(b), target: "_blank", rel: "noopener", text: "Megnyitás ↗" }));
    }
    paintState();
    c.body.append(state);

    // Übernehmen von einer anderen Seite (gleicher Betreiber)
    var others = S.config.sites.filter(function (x) { return x.id !== s.id && x.impressum && !impMissing(x.impressum).length; });
    if (others.length) {
      var cp = h("select", { class: "inp" }, h("option", { value: "", text: "Adatok átvétele másik oldalról…" }),
        others.map(function (x) { return h("option", { value: x.id, text: x.name + " – " + x.impressum.name }); }));
      cp.addEventListener("change", function () {
        var src = siteById(cp.value); if (!src) return;
        s.impressum = JSON.parse(JSON.stringify(src.impressum)); changed(); renderSettings();
        toast(t("Átvéve – ellenőrizd, hogy minden adat erre az oldalra is igaz."));
      });
      c.body.append(h("div", { class: "f" }, cp));
    }

    var grid = h("div", { class: "imp-grid" });
    IMP_FIELDS.forEach(function (f) {
      var key = f[0], multi = key === "extra" || key === "media";
      var i = multi ? h("textarea", { class: "inp", rows: 3, placeholder: f[3] }) : h("input", { class: "inp", placeholder: f[3], autocomplete: "off", type: key === "email" ? "email" : "text" });
      i.value = o[key] || "";
      var bad = function () { return f[2] && miss.indexOf(key) >= 0; };
      i.classList.toggle("err", bad());
      i.addEventListener("input", function () {
        if (i.value.trim()) o[key] = i.value; else delete o[key];
        changed(); paintState(); i.classList.toggle("err", bad()); renderSide();
      });
      var lab = h("label", { class: "f" + (multi || key === "purpose" || key === "name" ? " wide" : "") },
        h("span", null, t(f[1]) + (f[2] ? " *" : "")), i);
      grid.append(lab);
    });
    c.body.append(grid,
      h("p", { class: "hint", style: "margin:2px 0 0" }, "* kötelező. UID, GISA és cégjegyzékszám akkor kötelező, ha van ilyen. A pontos tartalomhoz kérdezd meg a könyvelőt vagy a WKO-t."));
    return c;
  }

  function renderBrand(s) {
    var c = card("Ügyfél-admin arculata", "Automatikusan a weboldal logóját és színeit használja. Itt felülírhatod.");
    s.brand = s.brand || {};
    function color(key, label) {
      var i = h("input", { type: "color", value: s.brand[key] || "#888888", style: s.brand[key] ? "" : "opacity:.45" });
      var clr = h("button", { class: "btn sm ghost", type: "button", text: s.brand[key] ? "Automatikus" : "auto (a weboldalból)", disabled: !s.brand[key] });
      i.addEventListener("input", function () { s.brand[key] = i.value; i.style.opacity = ""; clr.disabled = false; clr.textContent = t("Automatikus"); changed(); });
      clr.onclick = function () { delete s.brand[key]; i.style.opacity = ".45"; clr.disabled = true; clr.textContent = t("auto (a weboldalból)"); changed(); };
      return h("label", { class: "f" }, h("span", null, label), h("span", { class: "row-l" }, i, clr));
    }
    var logo = h("input", { class: "inp", value: s.brand.logo || "", placeholder: "img/logo.png (üres = automatikus)" });
    logo.addEventListener("input", function () { if (logo.value.trim()) s.brand.logo = logo.value.trim(); else delete s.brand.logo; changed(); });
    var wm = h("input", { class: "inp", value: s.brand.wordmark || "", placeholder: "pl. LOVEKINO (ha nincs logó)" });
    wm.addEventListener("input", function () { if (wm.value.trim()) s.brand.wordmark = wm.value.trim(); else delete s.brand.wordmark; changed(); });
    c.body.append(h("div", { class: "brand-grid" }, color("accent", "Fő szín"), color("bg", "Háttér")),
      field("Logó (kép a weboldal mappájában)", logo), field("Felirat logó helyett", wm));
    return c;
  }

  // ------------------------------------------------------------ Verlauf
  function renderHistory() {
    var box = $("tabHistory"); box.innerHTML = "";
    var s = siteById(S.cur);
    if (!baseSite(s.id)) { box.append(h("p", { class: "empty", text: "Közzététel után itt jelennek meg a verziók." })); return; }
    var mode = S.histMode || "page";
    box.append(h("div", { class: "seg", style: "margin-bottom:12px" },
      h("button", { class: mode === "page" ? "on" : "", text: "Ennek az oldalnak a tartalma", onclick: function () { S.histMode = "page"; renderHistory(); } }),
      h("button", { class: mode === "config" ? "on" : "", text: "Címek & be/ki (összes)", onclick: function () { S.histMode = "config"; renderHistory(); } })));
    box.append(h("p", { class: "hint", text: "Minden közzététel egy mentett verzió. A visszaállítás is új verzióként kerül be, így semmi nem vész el." }));
    var ul = h("ul", { class: "hist" }, h("li", null, h("div", { class: "spin" })));
    box.append(ul);
    api("history" + (mode === "page" ? "?id=" + encodeURIComponent(s.id) : "")).then(function (j) {
      ul.innerHTML = "";
      if (!j.commits.length) ul.append(h("li", { class: "muted", text: "Még nincs korábbi verzió." }));
      j.commits.forEach(function (c, i) {
        ul.append(h("li", null,
          h("span", { class: "t" }, h("b", { text: c.message.replace(/^admin:\s*/, "") }), h("small", { text: fmtDate(c.date) + " · " + c.sha.slice(0, 7) + (i === 0 ? " · aktuális" : "") })),
          i === 0 ? null : h("button", { class: "btn sm", text: "Visszaállítás", onclick: function () { restore(mode === "page" ? s.id : null, c); } })));
      });
    }).catch(function (e) { ul.innerHTML = ""; ul.append(h("li", { class: "err-text", text: e.message })); });
  }

  function restore(id, c) {
    var dirty = anyDirty();
    ask("Visszaállítás erre a verzióra?", h("div", null,
      h("p", { class: "muted", text: "„" + c.message.replace(/^admin:\s*/, "") + "” – " + fmtDate(c.date) }),
      dirty ? h("p", { class: "err-text", text: "A még nem közzétett változtatásaid elvesznek." }) : null,
      h("p", { class: "hint", text: "Élesben kb. 1 perc múlva jelenik meg." })), "Visszaállítás").then(function (y) {
      if (!y) return;
      api("restore", { id: id, sha: c.sha }).then(function () {
        clearDraft(); S.pages = {};
        return loadSites().then(function () { openSite(S.cur, true); watchDeploy(); toast("Visszaállítva ✓"); });
      }).catch(function (e) { toast(e.message, true); });
    });
  }

  // ------------------------------------------------------------ Veröffentlichen
  function anyDirty() {
    if (JSON.stringify(S.config) !== S.configBase) return true;
    return Object.keys(S.pages).some(function (id) { return pageDirty(S.pages[id]); });
  }
  function describeChanges() {
    var out = [], base = JSON.parse(S.configBase);
    S.config.sites.forEach(function (s) {
      var b = base.sites.find(function (x) { return x.id === s.id; });
      if (!b) { out.push("Új munka: " + s.name); return; }
      if (b.enabled !== s.enabled) out.push(s.name + ": " + (s.enabled ? "bekapcsolva" : "kikapcsolva"));
      if (b.slug !== s.slug) out.push(s.name + ": cím /" + b.slug + " → /" + s.slug);
      if (b.subdomain !== s.subdomain) out.push(s.name + ": aldomain " + (s.subdomain ? s.subdomain + "." + ROOT_DOMAIN : "eltávolítva"));
      if (b.name !== s.name) out.push("Átnevezve: " + b.name + " → " + s.name);
      if (b.group !== s.group) out.push(s.name + ": csoport → " + s.group);
      if (b.notes !== s.notes) out.push(s.name + ": jegyzet");
      if (JSON.stringify(b.aliases) !== JSON.stringify(s.aliases)) out.push(s.name + ": régi címek");
      if ((b.repo || "") !== (s.repo || "")) out.push(s.name + ": GitHub-repó → " + (s.repo || "nincs"));
      if (!!b.clientAdmin !== !!s.clientAdmin) out.push(s.name + ": " + (s.clientAdmin ? "ügyfél-admin bekapcsolva" : "ügyfél-admin kikapcsolva"));
      if (JSON.stringify(b.brand || {}) !== JSON.stringify(s.brand || {})) out.push(s.name + ": ügyfél-admin arculat");
    });
    base.sites.forEach(function (b) { if (!S.config.sites.some(function (s) { return s.id === b.id; })) out.push("Eltávolítva: " + b.name); });
    if (JSON.stringify(base.groups || []) !== JSON.stringify(S.config.groups || [])) out.push("Csoportok módosítva");
    Object.keys(S.pages).forEach(function (id) {
      var p = S.pages[id]; if (!pageDirty(p)) return;
      var s = siteById(id), bits = [];
      if (serialize(p) !== p.base) bits.push("szekciók/tartalom");
      if (JSON.stringify(p.overrides) !== p.overridesBase) bits.push("fordítások");
      if (p.uploads.length) bits.push(p.uploads.length + " új kép");
      out.push((s ? s.name : id) + ": " + bits.join(", "));
    });
    return out;
  }
  function updateSaveBar() {
    var dirty = S.config && anyDirty();
    $("saveBar").classList.toggle("hidden", !dirty);
    if (!dirty) return;
    var n = describeChanges().length;
    $("saveInfo").textContent = n + t(" nem közzétett változás");
    $("btnPublish").disabled = !allValid();
    $("btnPublish").title = allValid() ? "" : t("Javítsd a hibás mezőket a Beállításokban");
  }

  function configToSave() {
    var c = clone(S.config), base = JSON.parse(S.configBase);
    c.sites.forEach(function (s) {
      var b = base.sites.find(function (x) { return x.id === s.id; });
      s.aliases = (s.aliases || []).filter(function (a) { return a !== s.slug; });
      if (b && b.slug && b.slug !== s.slug && s.aliases.indexOf(b.slug) < 0) s.aliases.push(b.slug);
    });
    return c;
  }

  $("btnPublish").onclick = function () {
    var ch = describeChanges();
    ask("Közzététel", h("div", null, h("p", { class: "muted", text: "Ezek a változások kerülnek élesbe:" }), h("ul", null, ch.map(function (x) { return h("li", { text: x }); })),
      h("p", { class: "hint", text: "Élesben kb. 30–60 mp múlva látszik (Vercel deploy). Minden közzététel visszaállítható a Verziók fülön." })), "Közzététel").then(function (y) {
      if (!y) return;
      var pages = [];
      Object.keys(S.pages).forEach(function (id) {
        var p = S.pages[id]; if (!pageDirty(p)) return;
        var item = { id: id };
        if (serialize(p) !== p.base) { item.html = serialize(p); item.htmlSha = p.htmlSha; }
        if (JSON.stringify(p.overrides) !== p.overridesBase) { item.overrides = p.overrides; item.overridesSha = p.overridesSha; }
        if (p.uploads.length) item.uploads = p.uploads.map(function (u) { return { path: u.path, data: u.data }; });
        pages.push(item);
      });
      var summary = ch.slice(0, 4).join("; ") + (ch.length > 4 ? " (+" + (ch.length - 4) + ")" : "");
      $("btnPublish").disabled = true; $("btnPublish").textContent = t("Mentés…");
      api("save", { configSha: S.configSha, config: configToSave(), pages: pages, summary: summary }).then(function (j) {
        clearDraft();
        Object.keys(S.pages).forEach(function (id) {
          S.pages[id].uploads.forEach(function (u) { (S.pendingImgs[id] = S.pendingImgs[id] || {})[u.path] = u.dataUrl; });
        });
        var keep = S.cur; S.pages = {};
        return loadSites().then(function () { openSite(keep, true); watchDeploy(j.rev); toast("Közzétéve ✓ – élesítés folyamatban"); });
      }).catch(function (e) {
        saveDraft();
        if (e.status === 409) {
          ask("Ütközés", e.message + " A piszkozatod el van mentve.", "Újratöltés").then(function (y2) { if (y2) location.reload(); });
        } else toast(e.message, true);
      }).finally(function () { $("btnPublish").disabled = false; $("btnPublish").textContent = t("Közzététel"); updateSaveBar(); });
    });
  };

  $("btnDiscard").onclick = function () {
    ask("Minden változás elvetése?", "A még nem közzétett módosítások elvesznek.", "Elvetés", true).then(function (y) {
      if (!y) return;
      clearDraft(); S.config = JSON.parse(S.configBase); S.pages = {}; S.sel = null; S.draftPages = null;
      if (!siteById(S.cur)) S.cur = S.config.sites[0].id;
      openSite(S.cur, true); updateSaveBar();
    });
  };

  // Deploy beobachten: /data/sites.json vom Live-Deploy abfragen, bis die neue Rev da ist.
  function watchDeploy(rev) {
    rev = rev || (S.config && S.config.rev);
    var el = $("deploy"), t0 = Date.now();
    clearTimeout(S.deployT);
    el.innerHTML = ""; el.append(h("span", { class: "spin" }), h("span", { text: "Élesítés folyamatban…" }));
    (function poll() {
      fetch("/data/sites.json?t=" + Date.now(), { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
        if (j && j.rev === rev) {
          el.innerHTML = ""; el.append(h("span", { class: "pill ok", text: "Élesben ✓ " + new Date().toLocaleTimeString(L.locale, { hour: "2-digit", minute: "2-digit" }) }));
          return;
        }
        if (Date.now() - t0 > 6 * 60 * 1000) { el.innerHTML = ""; el.append(h("span", { class: "pill warn", text: "A deploy még nem látszik – nézd meg a Vercelben" })); return; }
        S.deployT = setTimeout(poll, 4000);
      });
    })();
  }

  // „⋯“-Menüs schließen, sobald man daneben oder auf einen Eintrag klickt
  document.addEventListener("click", function (e) {
    Array.prototype.forEach.call(document.querySelectorAll("details.more-menu[open]"), function (d) {
      if (!d.querySelector("summary").contains(e.target)) d.removeAttribute("open");
    });
  });

  window.addEventListener("beforeunload", function (e) {
    if (S.config && anyDirty()) { saveDraft(); e.preventDefault(); e.returnValue = ""; }
  });

  L.dom(document.body);
  var topGrow = document.querySelector(".top .grow");
  topGrow.after(L.switcher(function () { saveDraft(); }));
  $("vLogin").querySelector(".card").prepend(L.switcher());
  boot();
})();
