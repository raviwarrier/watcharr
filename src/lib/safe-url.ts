/**
 * Checks a service address the app is about to call from the server (for example Audiobookshelf).
 * Private and local addresses are allowed on purpose: a home server on 192.168.x.x or a local
 * domain is a normal setup. The cloud metadata addresses are blocked, because a server can
 * reach them without any network access of its own and they hold credentials.
 */

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata", "metadata.azure.internal"]);

function isLinkLocalV4(host: string): boolean {
  // 169.254.0.0/16 includes the AWS, Azure and GCP metadata address 169.254.169.254.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return !!m && Number(m[1]) === 169 && Number(m[2]) === 254;
}

function isMetadataV6(host: string): boolean {
  // fd00:ec2::254 is the AWS IPv6 metadata address.
  return host.replace(/[\[\]]/g, "").toLowerCase() === "fd00:ec2::254";
}

/** Returns the normalized base address (no trailing slash), or throws with a plain-language reason. */
export function checkServiceUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That isn't a valid address. Use a full address such as https://abs.example.com or http://192.168.1.50:13378.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The address must start with http:// or https://.");
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || isLinkLocalV4(host) || isMetadataV6(host)) {
    throw new Error("That address points at a cloud metadata service, which Watcharr won't call.");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}
