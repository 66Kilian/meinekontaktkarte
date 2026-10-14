// Kunden-Admins: Konten und Einladungen. Gespeichert verschlüsselt in
// data/accounts.enc.json im Repo (wird nicht mit der Website ausgeliefert und
// löst keinen Vercel-Build aus, siehe vercel.json → ignoreCommand).
import { getStorage, ConflictError } from "./storage.js";
import { encryptJson, decryptJson, verifyPassword } from "./crypto.js";
import { verifyData, readCookie, CLIENT_COOKIE } from "../../lib/session.js";
import { CONFIG_PATH } from "./sites.js";

export const ACCOUNTS_PATH = "data/accounts.enc.json";
export const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;

const empty = () => ({ accounts: [], invites: [] });

/** Liest Konten + Seiten-Konfiguration in einem Durchgang. */
export async function load(st = getStorage()) {
  const { tree } = await st.snapshot();
  const sha = tree.get(ACCOUNTS_PATH) || null;
  const data = sha ? decryptJson((await st.readBlob(sha)).toString("utf8")) : empty();
  data.accounts ||= []; data.invites ||= [];
  const config = JSON.parse((await st.readBlob(tree.get(CONFIG_PATH))).toString("utf8"));
  return { st, tree, sha, data, config };
}

/**
 * Ändert die Konten atomar: fn(data, config) mutiert data und gibt ein Ergebnis zurück.
 * Bei gleichzeitigen Änderungen wird neu gelesen und erneut versucht.
 */
export async function update(fn, message) {
  for (let i = 0; i < 3; i++) {
    const ctx = await load();
    const now = Date.now();
    ctx.data.invites = ctx.data.invites.filter(x => x.exp > now);
    const result = await fn(ctx.data, ctx.config);
    try {
      await ctx.st.commit({
        files: [{ path: ACCOUNTS_PATH, content: Buffer.from(encryptJson(ctx.data)) }],
        message: "accounts: " + message,
        expect: { [ACCOUNTS_PATH]: ctx.sha },
      });
      return result;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new ConflictError(ACCOUNTS_PATH);
}

/** Öffentliche Sicht auf ein Konto (ohne Hash/Secret). */
export function publicAccount(a) {
  return { id: a.id, site: a.site, name: a.name, username: a.username, totp: Boolean(a.totp), createdAt: a.createdAt, lastLogin: a.lastLogin || null, disabled: Boolean(a.disabled), pwTemp: Boolean(a.pwTemp) };
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._@-]{2,59}$/;
export function normUser(u) { return String(u || "").trim().toLowerCase(); }

export function checkPassword(pw) {
  pw = String(pw || "");
  if (pw.length < 10) return "Das Passwort muss mindestens 10 Zeichen haben.";
  if (pw.length > 200) return "Das Passwort ist zu lang.";
  return null;
}

/** Prüft das Kunden-Cookie gegen die gespeicherten Konten. */
export async function clientSession(req, ctx) {
  const tok = readCookie(req.headers.cookie, CLIENT_COOKIE);
  const d = await verifyData(process.env.ADMIN_SESSION_SECRET || "", tok, "c");
  if (!d) return null;
  ctx = ctx || (await load());
  const acc = ctx.data.accounts.find(a => a.id === d.a && a.site === d.s);
  if (!acc || acc.ver !== d.v || acc.disabled) return null;
  const site = ctx.config.sites.find(s => s.id === acc.site);
  if (!site || !site.clientAdmin) return null; // Kunden-Admin abgeschaltet → kein Zugang
  return { ...ctx, acc, site };
}

export function login(acc, password) { return verifyPassword(String(password || ""), acc.pw); }

export const DISABLED_MSG = "Dein Zugang ist derzeit gesperrt. Bitte melde dich bei uns.";

/** Merkt sich den letzten Login (Fehler hier dürfen den Login nie verhindern). */
export async function touchLogin(accId) {
  try {
    await update(data => { const a = data.accounts.find(x => x.id === accId); if (a) a.lastLogin = new Date().toISOString(); }, "Login");
  } catch {}
}
