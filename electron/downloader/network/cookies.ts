import { session } from "electron";

let exhentaiBridgedCookieCache: { value: string; expiresAt: number } | null =
  null;

/**
 * Retrieves cookies for E-Hentai/ExHentai bridge.
 * Merges cookies from both domains to prevent access denial (Sad Panda).
 */
export async function getExHentaiBridgedCookies(url: string): Promise<string> {
  if (!url.includes("exhentai.org")) return "";

  const now = Date.now();
  if (
    exhentaiBridgedCookieCache &&
    exhentaiBridgedCookieCache.expiresAt > now
  ) {
    return exhentaiBridgedCookieCache.value;
  }

  try {
    const [ehCookies, exCookies] = await Promise.all([
      Promise.all([
        session.defaultSession.cookies.get({ domain: ".e-hentai.org" }),
        session.defaultSession.cookies.get({ domain: "e-hentai.org" }),
      ]).then((res) => res.flat()),
      Promise.all([
        session.defaultSession.cookies.get({ domain: ".exhentai.org" }),
        session.defaultSession.cookies.get({ domain: "exhentai.org" }),
      ]).then((res) => res.flat()),
    ]);

    const cookieMap = new Map<string, string>();
    ehCookies.forEach((c) => cookieMap.set(c.name, c.value));
    exCookies.forEach((c) => cookieMap.set(c.name, c.value)); // ExHentai takes precedence

    const bridged = Array.from(cookieMap.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");

    if (bridged) {
      exhentaiBridgedCookieCache = { value: bridged, expiresAt: now + 5000 };
    }
    return bridged;
  } catch (e) {
    console.error("[Stealth] Cookie Bridge Failed:", e);
    return "";
  }
}

/** Syncs cookies from a partition (e.g., solver) to the default session. */
export async function syncCookies(fromPartition: string, targetDomain: string) {
  const sourceSession = session.fromPartition(fromPartition);
  const targetSession = session.defaultSession;

  const domainsToSync = [targetDomain];
  if (
    targetDomain.includes("e-hentai.org") ||
    targetDomain.includes("exhentai.org")
  ) {
    domainsToSync.push(
      ".e-hentai.org",
      "e-hentai.org",
      ".exhentai.org",
      "exhentai.org",
    );
  }

  try {
    const uniqueDomains = Array.from(new Set(domainsToSync));
    for (const d of uniqueDomains) {
      const cookies = await sourceSession.cookies.get({ domain: d });
      console.log(
        `[Stealth] Syncing ${cookies.length} cookies from ${fromPartition} for ${d}...`,
      );

      for (const cookie of cookies) {
        const domain = cookie.domain || d;
        const protocol = cookie.secure ? "https" : "http";
        const cleanDomain = domain.startsWith(".")
          ? domain.substring(1)
          : domain;

        await targetSession.cookies
          .set({
            url: `${protocol}://${cleanDomain}${cookie.path}`,
            name: cookie.name,
            value: cookie.value,
            domain: domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            expirationDate: cookie.expirationDate,
          })
          .catch(() => {});
      }
    }
    console.log(`[Stealth] Sync complete.`);
  } catch (err) {
    console.error(`[Stealth] Cookie sync failed:`, err);
  }
}

/** Pre-seeds solver partition with default session cookies to maintain login state. */
export async function preSeedCookies(targetPartition: string, url: string) {
  const sourceSession = session.defaultSession;
  const targetSession = session.fromPartition(targetPartition);

  let domains: string[] = [];
  if (url.includes("nhentai.net")) domains = ["nhentai.net"];
  else if (url.includes("e-hentai.org"))
    domains = [".e-hentai.org", "e-hentai.org"];
  else if (url.includes("exhentai.org")) {
    domains = [
      ".e-hentai.org",
      "e-hentai.org",
      ".exhentai.org",
      "exhentai.org",
    ];
  }

  if (!domains.length) return;

  try {
    const cookieLists = await Promise.all(
      domains.map((d) => sourceSession.cookies.get({ domain: d })),
    );
    const cookies = cookieLists.flat();
    console.log(`[Stealth] Pre-seeding ${cookies.length} cookies...`);

    for (const cookie of cookies) {
      if (!cookie.domain) continue;
      const cleanDomain = cookie.domain.startsWith(".")
        ? cookie.domain.substring(1)
        : cookie.domain;
      const cookieUrl = `https://${cleanDomain}${cookie.path}`;

      const setDetails: Electron.CookiesSetDetails = {
        url: cookieUrl,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite as any,
      };

      await targetSession.cookies.set(setDetails).catch(() => {});

      // Mirror ipb_ cookies to ExHentai domains if needed
      if (
        url.includes("exhentai.org") &&
        cookie.domain.includes("e-hentai.org") &&
        cookie.name.startsWith("ipb_")
      ) {
        const exDomains = [".exhentai.org", "exhentai.org"];
        for (const exDomain of exDomains) {
          const exClean = exDomain.startsWith(".")
            ? exDomain.substring(1)
            : exDomain;
          await targetSession.cookies
            .set({
              ...setDetails,
              url: `https://${exClean}${cookie.path}`,
              domain: exDomain,
            })
            .catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error(`[Stealth] Pre-seed failed:`, err);
  }
}
