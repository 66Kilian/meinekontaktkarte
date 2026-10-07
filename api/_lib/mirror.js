// Jede Kundenseite liegt zusätzlich in einem eigenen Repo (site.repo, z. B.
// "66Kilian/LoveKinoADMIN"). Gespiegelt wird der Inhalt des Seitenordners.
import { repoStorage } from "./storage.js";

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function toRepoPath(site, path) {
  const pre = site.folder + "/";
  return path.startsWith(pre) ? path.slice(pre.length) : null;
}

/** Spiegelt geänderte Dateien. Fehler brechen das Speichern nie ab – sie werden gemeldet. */
export async function mirrorFiles(site, files, message) {
  if (!site || !site.folder || !REPO_RE.test(site.repo || "") || (site.features && site.features.repo === false)) return null;
  if (process.env.MK_LOCAL_REPO || !process.env.GITHUB_TOKEN) return { skipped: true };
  const mapped = files.map(f => ({ path: toRepoPath(site, f.path), content: f.content })).filter(f => f.path);
  if (!mapped.length) return null;
  try {
    const st = repoStorage(site.repo);
    if (await st.isEmpty()) {
      const first = mapped.find(f => f.content);
      if (!first) return null;
      await st.init(first);
    }
    const r = await st.commit({ files: mapped, message });
    return { ok: true, commit: r.commit };
  } catch (e) {
    return { ok: false, error: `Spiegel-Repo ${site.repo}: ${String(e.message || e).slice(0, 160)}` };
  }
}

/** Überträgt den kompletten Seitenordner (z. B. nach dem Anlegen eines Repos). */
export async function mirrorAll(site, st, tree) {
  if (!REPO_RE.test(site.repo || "")) throw new Error("Kein gültiges Repo eingetragen (Format: besitzer/repo)");
  if (site.features && site.features.repo === false) throw new Error("Das eigene Repo ist für diese Seite ausgeschaltet (Einstellungen → Funktionen).");
  const files = [];
  for (const [path, sha] of tree) {
    if (path.startsWith(site.folder + "/")) files.push({ path, content: await st.readBlob(sha) });
  }
  // Dateien, die es im Hauptrepo nicht mehr gibt, auch im Spiegel entfernen
  const mirror = repoStorage(site.repo);
  if (!(await mirror.isEmpty())) {
    const { tree: mt } = await mirror.snapshot();
    for (const p of mt.keys()) if (!tree.has(site.folder + "/" + p)) files.push({ path: site.folder + "/" + p, content: null });
  }
  return mirrorFiles(site, files, "Vollständige Synchronisierung aus meinekontaktkarte.com");
}
