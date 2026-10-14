// Betreiber: Kunden-Admins verwalten (einladen, Passwort-Link, 2FA zurücksetzen,
// löschen) und das Kunden-Repo vollständig synchronisieren.
import { send, guard, body } from "./_lib/http.js";
import { randomToken, sha256, hashPassword } from "./_lib/crypto.js";
import { load, update, publicAccount, INVITE_TTL, checkPassword, normUser, USERNAME_RE } from "./_lib/accounts.js";
import { mirrorAll } from "./_lib/mirror.js";

function inviteLink(req, site, token) {
  const host = process.env.ROOT_DOMAIN || req.headers.host || "meinekontaktkarte.com";
  const proto = /^(localhost|127\.)/.test(host) ? "http" : "https";
  return `${proto}://${host}/${site.slug}/admin/#invite=${token}`;
}

function siteView(data, siteId) {
  const now = Date.now();
  return {
    accounts: data.accounts.filter(a => a.site === siteId).map(publicAccount),
    invites: data.invites.filter(i => i.site === siteId && i.exp > now).map(i => ({ id: i.id, kind: i.kind, account: i.account || null, name: i.name || "", exp: i.exp, createdAt: i.createdAt })),
  };
}

export default async function handler(req, res) {
  const isGet = req.method === "GET";
  if (!(await guard(req, res, { method: isGet ? "GET" : "POST" }))) return;
  try {
    if (isGet) {
      const { data, config } = await load();
      // Ohne ?site: Anzahl der Kunden-Admins je Seite (für die Seitenleiste)
      // ?all=1: alle Kunden-Admins aller Seiten (Übersicht)
      if (req.query.all) {
        const sites = config.sites.filter(s => s.folder).map(s => ({
          site: { id: s.id, name: s.name, slug: s.slug, enabled: s.enabled, clientAdmin: s.clientAdmin, group: s.group },
          ...siteView(data, s.id),
        }));
        return send(res, 200, { sites });
      }
      if (!req.query.site) {
        const counts = {};
        for (const a of data.accounts) counts[a.site] = (counts[a.site] || 0) + 1;
        return send(res, 200, { counts });
      }
      if (!config.sites.some(s => s.id === req.query.site)) return send(res, 404, { error: "Seite nicht gefunden" });
      return send(res, 200, siteView(data, req.query.site));
    }

    const b = await body(req);
    const { config, st, tree } = await load();
    const site = config.sites.find(s => s.id === b.site && s.folder);
    if (!site) return send(res, 404, { error: "Seite nicht gefunden" });

    if (b.action === "sync") {
      const r = await mirrorAll(site, st, tree);
      if (r && r.ok === false) return send(res, 502, { error: r.error });
      return send(res, 200, { ok: true, result: r });
    }

    let link = null;
    const bad = msg => Object.assign(new Error(msg), { status: 400 });
    const view = await update((data) => {
      const acc = b.account ? data.accounts.find(a => a.id === b.account && a.site === site.id) : null;
      if ((b.account || ["update", "setpw", "delete", "reset2fa", "reset", "disable", "enable"].includes(b.action)) && !acc) throw Object.assign(new Error("Konto nicht gefunden"), { status: 404 });
      const checkUser = (u, self) => {
        if (!USERNAME_RE.test(u)) throw bad("Felhasználónév: min. 3 karakter, kisbetű, szám, . _ - @");
        if (data.accounts.some(x => x.site === site.id && x.username === u && x !== self)) throw bad("Ez a felhasználónév már foglalt ennél az oldalnál.");
      };
      if (b.action === "create") {
        // Betreiber legt den Zugang direkt an (Name, Benutzername, Passwort)
        const name = String(b.name || "").trim().slice(0, 80), username = normUser(b.username);
        if (!name) throw bad("Add meg a nevet.");
        checkUser(username);
        const pwErr = checkPassword(b.password);
        if (pwErr) throw bad("A jelszó legalább 10 karakter legyen.");
        data.accounts.push({ id: randomToken(9), site: site.id, name, username, pw: hashPassword(b.password), pwTemp: true, totp: null, ver: 1, createdAt: new Date().toISOString() });
      } else if (b.action === "update") {
        const name = String(b.name || "").trim().slice(0, 80), username = normUser(b.username);
        if (!name) throw bad("Add meg a nevet.");
        checkUser(username, acc);
        if (acc.username !== username) acc.ver = (acc.ver || 1) + 1; // neu anmelden
        acc.name = name; acc.username = username;
      } else if (b.action === "setpw") {
        if (checkPassword(b.password)) throw bad("A jelszó legalább 10 karakter legyen.");
        acc.pw = hashPassword(b.password); acc.pwTemp = true; acc.ver = (acc.ver || 1) + 1;
      } else if (b.action === "invite" || b.action === "reset") {
        const token = randomToken(24);
        data.invites.push({
          id: randomToken(6), hash: sha256(token), site: site.id,
          kind: b.action === "reset" ? "reset" : "register", account: acc ? acc.id : undefined,
          name: b.action === "invite" ? String(b.name || "").trim().slice(0, 80) || undefined : undefined,
          exp: Date.now() + INVITE_TTL, createdAt: new Date().toISOString(),
        });
        link = inviteLink(req, site, token);
      } else if (b.action === "revoke") {
        data.invites = data.invites.filter(i => !(i.id === b.invite && i.site === site.id));
      } else if (b.action === "delete") {
        data.accounts = data.accounts.filter(a => a !== acc);
        data.invites = data.invites.filter(i => i.account !== acc.id);
      } else if (b.action === "disable") {
        acc.disabled = true; acc.ver = (acc.ver || 1) + 1; // sofort abmelden
      } else if (b.action === "enable") {
        delete acc.disabled;
      } else if (b.action === "reset2fa") {
        acc.totp = null; acc.ver = (acc.ver || 1) + 1;
      } else throw Object.assign(new Error("Unbekannte Aktion"), { status: 400 });
      return siteView(data, site.id);
    }, `${site.name}: ${b.action}`);
    send(res, 200, { ok: true, link, ...view });
  } catch (e) {
    send(res, e.status || 500, { error: String(e.message || e) });
  }
}
