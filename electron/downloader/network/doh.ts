import axios from "axios";
import { DOH_PROVIDERS, FALLBACK_IPS } from "./constants";

const dohCache = new Map<string, { ip: string; expiresAt: number }>();

/** Resolves hostname via DoH (Cloudflare/Google) to bypass ISP DNS blocking. */
export async function resolveWithDoH(hostname: string): Promise<string> {
  const cached = dohCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ip;
  }

  for (const provider of DOH_PROVIDERS) {
    try {
      const url = provider.url.replace("{HOSTNAME}", hostname);
      const response = await axios.get(url, {
        headers: { Accept: "application/dns-json" },
        timeout: 10000,
      });

      const aRecord = response.data?.Answer?.find((a: any) => a.type === 1);
      if (aRecord?.data) {
        dohCache.set(hostname, {
          ip: aRecord.data,
          expiresAt: Date.now() + 300000,
        });
        return aRecord.data;
      }
    } catch (e: any) {
      console.error(`[DoH] ${provider.name} failed:`, e.message);
    }
  }

  if (FALLBACK_IPS[hostname]) {
    return FALLBACK_IPS[hostname];
  }

  throw new Error(`No IP found for ${hostname}`);
}
