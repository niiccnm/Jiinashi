export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

/**
 * Spoofs all Client Hints to match the User-Agent perfectly.
 * This is crucial for bypassing advanced bot detection.
 */
export const CLIENT_HINTS = {
  "Sec-CH-UA":
    '"Google Chrome";v="134", "Chromium";v="134", "Not:A-Brand";v="24"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "Sec-CH-UA-Platform-Version": '"10.0.0"',
  "Sec-CH-UA-Arch": '"x86"',
  "Sec-CH-UA-Bitness": '"64"',
  "Sec-CH-UA-Model": '""',
  "Sec-CH-UA-Full-Version-List":
    '"Google Chrome";v="134.0.6998.205", "Chromium";v="134.0.6998.205", "Not:A-Brand";v="24.0.0.0"',
};

export const FALLBACK_IPS: Record<string, string> = {
  "ltn.hitomi.la": "172.67.0.1", // Cloudflare CDN
  "hitomi.la": "172.67.0.1",
  "aa.hitomi.la": "172.67.0.1", // Original images
  "ba.hitomi.la": "172.67.0.1", // Original images
};

export const DOH_PROVIDERS = [
  { name: "Google", url: "https://dns.google/resolve?name={HOSTNAME}&type=A" },
  {
    name: "Cloudflare",
    url: "https://cloudflare-dns.com/dns-query?name={HOSTNAME}&type=A",
  },
];
