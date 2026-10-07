// Kunden-Admin (/<slug>/admin/): Registrierung per Einladung, Login mit
// optionaler 2FA, eigene Seite laden und speichern. Eine Funktion für alles
// (?a=…), damit das Vercel-Funktionslimit nicht erreicht wird.
import { send, guard, body, clientIp, setSessionCookie } from "./_lib/http.js";
import { verifyTotp, hashPassword, sha256, randomToken } from "./_lib/crypto.js";
import { lockedFor, fail, success, consumeStep, slow } from "./_lib/limiter.js";
import { signData, verifyData, CLIENT_COOKIE, SESSION_TTL, PRE_TTL } from "../lib/session.js";
import { load, update, clientSession, publicAccount, checkPassword, normUser, USERNAME_RE, login, DISABLED_MSG, touchLogin } from "./_lib/accounts.js";
import { htmlPath, overridesPath, parseOverrides, renderOverrides, cleanOverrides, validUpload, featureOn } from "./_lib/sites.js";
import { checkClientHtml, checkOverrides } from "./_lib/sanitize.js";
import { mirrorFiles } from "./_lib/mirror.js";
import { brandFor } from "./_lib/brand.js";
import { publicThemes, themeOf, applyTheme } from "../lib/themes.js";
import { ConflictError } from "./_lib/storage.js";

const SECRET = () => process.env.ADMIN_SESSION_SECRET || "";
const HELP_WHATSAPP = "36206270766";
const MAX_HTML = 3 << 20;
const MAX_UPLOAD = 3 << 20;

async function startSession(req, res, acc) {
  const tok = await signData(SECRET(), "c", { s: acc.site, a: acc.id, v: acc.ver }, SESSION_TTL);
  setSessionCookie(req, res, tok, SESSION_TTL, CLIENT_COOKIE);
  await touchLogin(acc.id);
}

function siteBySlug(config, slug) {
  slug = String(slug || "").toLowerCase();
  return config.sites.find(s => s.folder && s.slug === slug && s.clientAdmin) || null;
}

async function siteHtml(ctx, site) {
  const sha = ctx.tree.get(htmlPath(site));
  return sha ? (await ctx.st.readBlob(sha)).toString("utf8") : "";
}

function locked(req, res) {
  const left = lockedFor(clientIp(req));
  if (left) send(res, 429, { error: `Zu viele Versuche. Bitte in ${Math.ceil(left / 60000)} Min. erneut versuchen.` });
  return Boolean(left);
}

const actions = {
  // Öffentlich: Name + Branding der Seite, Login-Zustand
  async status(req, res) {
    const ctx = await load();
    const site = siteBySlug(ctx.config, req.query.site);
    if (!site) return send(res, 404, { error: "Seite nicht gefunden" });
    const sess = await clientSession(req, ctx);
    const mine = sess && sess.site.id === site.id ? sess : null;
    send(res, 200, {
      site: { id: site.id, name: site.name, slug: site.slug },
      features: { sections: featureOn(site, "clientSections"), design: featureOn(site, "clientDesign") },
      brand: brandFor(site, await siteHtml(ctx, site)),
      help: HELP_WHATSAPP,
      translate: Boolean(process.env.DEEPL_API_KEY),
      themes: publicThemes(),
      loggedIn: Boolean(mine),
      account: mine ? publicAccount(mine.acc) : null,
    });
  },

  // Einladung prüfen (vor dem Registrierungsformular)
  async invite(req, res) {
    const { token } = await body(req);
    const ctx = await load();
    const inv = ctx.data.invites.find(i => i.hash === sha256(token) && i.exp > Date.now());
    if (!inv) return send(res, 404, { error: "Dieser Einladungslink ist ungültig oder abgelaufen. Bitte fordere einen neuen an." });
    const acc = inv.account ? ctx.data.accounts.find(a => a.id === inv.account) : null;
    const site = ctx.config.sites.find(s => s.id === inv.site);
    if (!site || !site.clientAdmin) return send(res, 404, { error: "Der Admin-Zugang für diese Website ist noch nicht freigeschaltet." });
    send(res, 200, { kind: inv.kind, site: site ? site.slug : null, name: acc ? acc.name : (inv.name || ""), username: acc ? acc.username : "" });
  },

  // Registrierung (neues Konto) oder neues Passwort (Reset-Link)
  async register(req, res) {
    if (locked(req, res)) return;
    const b = await body(req);
    const pwErr = checkPassword(b.password);
    if (pwErr) return send(res, 400, { error: pwErr });
    const name = String(b.name || "").trim().slice(0, 80);
    const username = normUser(b.username);
    await slow();
    let acc;
    try {
      acc = await update((data, config) => {
        const inv = data.invites.find(i => i.hash === sha256(b.token) && i.exp > Date.now());
        if (!inv) throw new UserError("Dieser Einladungslink ist ungültig oder abgelaufen.");
        if (!config.sites.some(x => x.id === inv.site && x.clientAdmin)) throw new UserError("Der Admin-Zugang für diese Website ist noch nicht freigeschaltet.");
        let a;
        if (inv.kind === "reset") {
          a = data.accounts.find(x => x.id === inv.account);
          if (!a) throw new UserError("Konto nicht gefunden.");
          if (a.disabled) throw new UserError(DISABLED_MSG);
          a.pw = hashPassword(b.password);
          a.ver = (a.ver || 1) + 1;
        } else {
          if (!name) throw new UserError("Bitte gib deinen Namen ein.");
          if (!USERNAME_RE.test(username)) throw new UserError("Benutzername: mind. 3 Zeichen, nur Kleinbuchstaben, Zahlen und . _ - @");
          if (data.accounts.some(x => x.site === inv.site && x.username === username)) throw new UserError("Dieser Benutzername ist schon vergeben.");
          a = { id: randomToken(9), site: inv.site, name, username, pw: hashPassword(b.password), totp: null, ver: 1, createdAt: new Date().toISOString() };
          data.accounts.push(a);
        }
        data.invites = data.invites.filter(i => i !== inv);
        return a;
      }, "Einladung eingelöst");
    } catch (e) {
      if (e instanceof UserError) { fail(clientIp(req)); return send(res, 400, { error: e.message }); }
      throw e;
    }
    await startSession(req, res, acc);
    send(res, 200, { ok: true, account: publicAccount(acc) });
  },

  async login(req, res) {
    if (locked(req, res)) return;
    const b = await body(req);
    const ctx = await load();
    const site = siteBySlug(ctx.config, b.site);
    await slow();
    const acc = site && ctx.data.accounts.find(a => a.site === site.id && a.username === normUser(b.username));
    if (!acc || !login(acc, b.password)) { fail(clientIp(req)); return send(res, 401, { error: "Benutzername oder Passwort falsch" }); }
    if (acc.disabled) return send(res, 403, { error: DISABLED_MSG });
    if (acc.totp) return send(res, 200, { pre: await signData(SECRET(), "cp", { s: acc.site, a: acc.id, v: acc.ver }, PRE_TTL) });
    success(clientIp(req));
    await startSession(req, res, acc);
    send(res, 200, { ok: true });
  },

  async verify(req, res) {
    if (locked(req, res)) return;
    const b = await body(req);
    const d = await verifyData(SECRET(), b.pre, "cp");
    await slow();
    if (!d) return send(res, 401, { error: "Sitzung abgelaufen – bitte erneut anmelden", restart: true });
    const ctx = await load();
    const acc = ctx.data.accounts.find(a => a.id === d.a && a.site === d.s && a.ver === d.v);
    if (!acc || !acc.totp) return send(res, 401, { error: "Bitte erneut anmelden", restart: true });
    if (acc.disabled) return send(res, 403, { error: DISABLED_MSG, restart: true });
    const step = verifyTotp(acc.totp, b.code);
    if (step === null || !consumeStep(step, acc.id)) { fail(clientIp(req)); return send(res, 401, { error: "Code ungültig oder schon verwendet" }); }
    success(clientIp(req));
    await startSession(req, res, acc);
    send(res, 200, { ok: true });
  },

  async logout(req, res) {
    setSessionCookie(req, res, "", 0, CLIENT_COOKIE);
    send(res, 200, { ok: true });
  },

  // 2FA ein/aus (eingeloggt). Das Geheimnis erzeugt der Browser, der Code beweist die Einrichtung.
  async totp(req, res) {
    const sess = await clientSession(req);
    if (!sess) return send(res, 401, { error: "Nicht angemeldet" });
    const b = await body(req);
    if (b.action === "enable") {
      const secret = String(b.secret || "").toUpperCase();
      if (!/^[A-Z2-7]{16,64}$/.test(secret)) return send(res, 400, { error: "Ungültiger Schlüssel" });
      const step = verifyTotp(secret, b.code);
      if (step === null || !consumeStep(step, sess.acc.id)) return send(res, 400, { error: "Der Code passt nicht. Prüfe die Uhrzeit am Handy und versuche es erneut." });
      await update(data => { const a = data.accounts.find(x => x.id === sess.acc.id); if (a) a.totp = secret; }, "2FA aktiviert");
      return send(res, 200, { ok: true, totp: true });
    }
    if (b.action === "disable") {
      if (!login(sess.acc, b.password)) return send(res, 401, { error: "Passwort falsch" });
      await update(data => { const a = data.accounts.find(x => x.id === sess.acc.id); if (a) a.totp = null; }, "2FA deaktiviert");
      return send(res, 200, { ok: true, totp: false });
    }
    send(res, 400, { error: "Unbekannte Aktion" });
  },

  async password(req, res) {
    const sess = await clientSession(req);
    if (!sess) return send(res, 401, { error: "Nicht angemeldet" });
    const b = await body(req);
    await slow();
    if (!login(sess.acc, b.old)) return send(res, 401, { error: "Aktuelles Passwort falsch" });
    const pwErr = checkPassword(b.password);
    if (pwErr) return send(res, 400, { error: pwErr });
    const acc = await update(data => {
      const a = data.accounts.find(x => x.id === sess.acc.id);
      a.pw = hashPassword(b.password); a.ver = (a.ver || 1) + 1;
      return a;
    }, "Passwort geändert");
    await startSession(req, res, acc); // alle anderen Sitzungen werden ungültig
    send(res, 200, { ok: true });
  },

  async source(req, res) {
    const sess = await clientSession(req);
    if (!sess) return send(res, 401, { error: "Nicht angemeldet" });
    const { st, tree, site } = sess;
    const hp = htmlPath(site), op = overridesPath(site);
    if (!tree.get(hp)) return send(res, 404, { error: "Seite fehlt" });
    const overridesSha = tree.get(op) || null;
    send(res, 200, {
      html: (await st.readBlob(tree.get(hp))).toString("utf8"),
      htmlSha: tree.get(hp),
      overrides: overridesSha ? parseOverrides(await st.readBlob(overridesSha)) : {},
      overridesSha,
      base: "/" + site.slug + "/",
    });
  },

  // Speichern = ein Commit im Haupt-Repo (Vercel deployt) + Spiegel ins Kunden-Repo.
  async save(req, res) {
    const sess = await clientSession(req);
    if (!sess) return send(res, 401, { error: "Nicht angemeldet" });
    const { st, tree, site, acc } = sess;
    const b = await body(req);
    const hp = htmlPath(site), op = overridesPath(site);
    const files = [], expect = {};
    const rev = randomToken(6);

    if (typeof b.html === "string") {
      if (b.html.length > MAX_HTML || !/<html[\s>]/i.test(b.html)) return send(res, 400, { error: "Seite ungültig" });
      const oldHtml = (await st.readBlob(tree.get(hp))).toString("utf8");
      // Farbdesign immer aus der eigenen Liste setzen – nie fremdes CSS übernehmen;
      // ist die Design-Auswahl für diese Seite aus, bleibt das bisherige Design.
      b.html = applyTheme(b.html, themeOf(featureOn(site, "clientDesign") ? b.html : oldHtml));
      const bad = checkClientHtml(applyTheme(oldHtml, "standard"), applyTheme(b.html, "standard"));
      if (bad) return send(res, 400, { error: bad });
      expect[hp] = b.htmlSha || null;
      files.push({ path: hp, content: Buffer.from(stampRev(b.html, rev), "utf8") });
    }
    if (b.overrides) {
      const o = cleanOverrides(b.overrides);
      const bad = checkOverrides(o);
      if (bad) return send(res, 400, { error: bad });
      expect[op] = b.overridesSha || null;
      files.push({ path: op, content: Object.keys(o).length ? Buffer.from(renderOverrides(o)) : null });
    }
    for (const u of b.uploads || []) {
      if (!validUpload(u.path)) return send(res, 400, { error: "Ungültiger Bildname" });
      const buf = Buffer.from(String(u.data || ""), "base64");
      if (!buf.length || buf.length > MAX_UPLOAD) return send(res, 400, { error: "Bild zu groß (max. 3 MB)" });
      if (!isImage(buf)) return send(res, 400, { error: "Datei ist kein Bild" });
      const path = site.folder + "/" + u.path;
      if (tree.has(path)) return send(res, 400, { error: "Bild existiert schon" });
      files.push({ path, content: buf });
    }
    if (!files.length) return send(res, 400, { error: "Keine Änderungen" });
    const summary = String(b.summary || "Änderungen").replace(/\s+/g, " ").slice(0, 160);
    const message = `kunde (${site.name}, ${acc.name}): ${summary}`;
    try {
      const r = await st.commit({ files, message, expect });
      const mirror = await mirrorFiles(site, files, message);
      send(res, 200, { ok: true, commit: r.commit, rev, mirror });
    } catch (e) {
      if (e instanceof ConflictError) return send(res, 409, { error: "Inzwischen wurde etwas anderes gespeichert. Bitte die Seite neu laden – deine Änderungen bleiben als Entwurf erhalten." });
      throw e;
    }
  },
};

class UserError extends Error {}

// Merkt sich im HTML, welche Version gerade gespeichert wurde – daran erkennt
// der Kunden-Admin, wann die neue Version live ist.
function stampRev(html, rev) {
  const tag = `<meta name="mk-rev" content="${rev}">`;
  if (/<meta name="mk-rev"[^>]*>/.test(html)) return html.replace(/<meta name="mk-rev"[^>]*>/, tag);
  return html.replace(/<head([^>]*)>/i, `<head$1>\n${tag}`);
}

function isImage(buf) {
  const h = buf.subarray(0, 12).toString("hex");
  return h.startsWith("ffd8ff") || h.startsWith("89504e47") || h.startsWith("47494638") || (h.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP");
}

const GET = new Set(["status", "source"]);

export default async function handler(req, res) {
  const a = String((req.query && req.query.a) || "");
  const fn = Object.prototype.hasOwnProperty.call(actions, a) ? actions[a] : null;
  if (!fn) return send(res, 404, { error: "Unbekannt" });
  if (!(await guard(req, res, { method: GET.has(a) ? "GET" : "POST", auth: false }))) return;
  try {
    await fn(req, res);
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}
