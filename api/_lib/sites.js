import { RESERVED_SLUGS } from "../../lib/route.js";
import { cleanImpressum } from "../../lib/impressum.js";

export const CONFIG_PATH = "data/sites.json";
export const CONFIG_JS_PATH = "data/sites.js"; // wird von middleware.js importiert

/** sites.json + sites.js (gleicher Inhalt) für einen Commit. */
export function configFiles(cfg) {
  const json = JSON.stringify(cfg, null, 2);
  return [
    { path: CONFIG_PATH, content: Buffer.from(json + "\n") },
    { path: CONFIG_JS_PATH, content: Buffer.from("// Automatisch aus data/sites.json erzeugt (Admin) – nicht von Hand bearbeiten.\nexport default " + json + ";\n") },
  ];
}
export const WORKS_DIR = "Munkák";
export const OVERRIDES_FILE = "mk-i18n.js";

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const IMG_RE = /^img\/[a-z0-9][a-z0-9._-]{0,80}\.(jpe?g|png|webp|gif|avif)$/;

export const htmlPath = site => (site.folder ? `${site.folder}/index.html` : "index.html");
export const overridesPath = site => (site.folder ? `${site.folder}/${OVERRIDES_FILE}` : OVERRIDES_FILE);

export function discover(tree, config) {
  const known = new Set(config.sites.map(s => s.folder));
  const out = new Set();
  for (const p of tree.keys()) {
    const m = p.match(/^Munkák\/([^/]+)\/index\.html$/);
    if (m && !known.has(`${WORKS_DIR}/${m[1]}`)) out.add(`${WORKS_DIR}/${m[1]}`);
  }
  return [...out].sort();
}

/** Prüft die Konfiguration vom Client. Wirft einen Fehlertext. */
export function validateConfig(next, prev, tree) {
  if (!next || !Array.isArray(next.sites)) throw "Ungültige Konfiguration";
  const ids = new Set(), slugs = new Map(), subs = new Map();
  const prevById = new Map((prev.sites || []).map(s => [s.id, s]));
  const clean = [];
  for (const s of next.sites) {
    const id = String(s.id || "");
    if (!ID_RE.test(id) || ids.has(id)) throw `Ungültige oder doppelte ID: ${id}`;
    ids.add(id);
    const old = prevById.get(id);
    const folder = old ? old.folder : String(s.folder || "");
    if (!old && !(folder.startsWith(WORKS_DIR + "/") && tree.has(`${folder}/index.html`))) throw `Ordner nicht gefunden: ${folder}`;
    const isMain = folder === "";
    const slug = isMain ? "" : String(s.slug || "").toLowerCase().trim();
    const subdomain = isMain ? "" : String(s.subdomain || "").toLowerCase().trim();
    if (!isMain) {
      if (!NAME_RE.test(slug)) throw `Ungültige Adresse „${slug}“ (nur a–z, 0–9, Bindestrich)`;
      if (RESERVED_SLUGS.includes(slug)) throw `„${slug}“ ist reserviert`;
    }
    if (subdomain && (!NAME_RE.test(subdomain) || subdomain === "www")) throw `Ungültige Subdomain „${subdomain}“`;
    const aliases = [...new Set((s.aliases || []).map(a => String(a).toLowerCase().trim()).filter(a => NAME_RE.test(a) && a !== slug && !RESERVED_SLUGS.includes(a)))];
    for (const x of [slug, ...aliases]) {
      if (!x) continue;
      if (slugs.has(x)) throw `Adresse „/${x}“ wird schon von „${slugs.get(x)}“ verwendet`;
      slugs.set(x, s.name || id);
    }
    if (subdomain) {
      if (subs.has(subdomain)) throw `Subdomain „${subdomain}“ doppelt`;
      subs.set(subdomain, id);
    }
    clean.push({
      id,
      name: String(s.name || id).slice(0, 120),
      group: String(s.group || "Kunden").slice(0, 60),
      folder,
      slug,
      subdomain,
      enabled: isMain ? true : Boolean(s.enabled),
      aliases,
      notes: String(s.notes || "").slice(0, 2000),
      clientAdmin: isMain ? false : Boolean(s.clientAdmin),
      repo: cleanRepo(s.repo),
      brand: cleanBrand(s.brand),
      impressum: cleanImpressum(s.impressum),
      features: cleanFeatures(s.features),
    });
  }
  if (!clean.some(s => s.folder === "")) throw "Die Startseite darf nicht entfernt werden";
  const groups = [...new Set([...(next.groups || []), ...clean.map(s => s.group)].map(g => String(g).slice(0, 60)).filter(Boolean))];
  return { rev: Math.random().toString(36).slice(2, 10), updatedAt: new Date().toISOString(), groups, sites: clean };
}

export function validUpload(rel) { return IMG_RE.test(rel); }

const REPO_RE = /^[\w.-]{1,39}\/[\w.-]{1,100}$/;
function cleanRepo(r) {
  r = String(r || "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return REPO_RE.test(r) ? r : "";
}
// Funktionen je Seite (Admin → Einstellungen → Funktionen). Fehlt ein Schlüssel, ist die Funktion an.
export const FEATURE_KEYS = ["impressum", "repo", "brand", "clientSections", "clientDesign"];
function cleanFeatures(f) {
  const out = {};
  if (!f || typeof f !== "object") return out;
  for (const k of FEATURE_KEYS) if (f[k] === false) out[k] = false;
  return out;
}
export const featureOn = (site, key) => !(site && site.features && site.features[key] === false);

function cleanBrand(b) {
  const out = {};
  if (!b || typeof b !== "object") return out;
  for (const k of ["accent", "accent2", "bg", "text"]) if (/^#[0-9a-f]{3,8}$/i.test(b[k] || "")) out[k] = b[k];
  if (typeof b.logo === "string" && /^img\/[\w.-]{1,90}$/.test(b.logo)) out.logo = b.logo;
  if (typeof b.wordmark === "string" && b.wordmark.trim()) out.wordmark = b.wordmark.trim().slice(0, 60);
  return out;
}

// ------------------------------------------------ mk-i18n.js (Text-Overrides)
const START = "/*MK-START*/", END = "/*MK-END*/";

export function renderOverrides(obj) {
  const json = JSON.stringify(obj, null, 1).replace(/</g, "\\u003c");
  return `/* Textänderungen aus /admin – bitte nicht von Hand bearbeiten. */
(function(o){var I=window.I18N=window.I18N||{};for(var l in o){I[l]=Object.assign(I[l]||{},o[l]);}})(${START}${json}${END});
`;
}

export function parseOverrides(src) {
  if (!src) return {};
  const s = src.toString("utf8");
  const a = s.indexOf(START), b = s.indexOf(END);
  if (a < 0 || b < 0) return {};
  try { return JSON.parse(s.slice(a + START.length, b)); } catch { return {}; }
}

export function cleanOverrides(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const [lang, map] of Object.entries(o)) {
    if (!/^[a-z]{2}(-[a-z]{2})?$/i.test(lang) || !map || typeof map !== "object") continue;
    for (const [k, v] of Object.entries(map)) {
      if (!/^[\w.-]{1,80}$/.test(k) || typeof v !== "string") continue;
      (out[lang] ||= {})[k] = v.slice(0, 20000);
    }
  }
  return out;
}
