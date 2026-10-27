import { SignJWT, importPKCS8 } from "jose";
import { DomainError } from "./domain";
import type { Env } from "./env";
export function normalizeText(text: string) {
  return text.replace(/\r\n?/g, "\n").normalize("NFC");
}
export function validateSourceUrl(input: string) {
  const u = new URL(input);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new DomainError(
      "URL_NOT_ALLOWED",
      "Use a public HTTP(S) source",
      422,
    );
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".invalid") ||
    h.includes(":") ||
    /^\d+(\.\d+){3}$/.test(h) ||
    h === "metadata.google.internal" ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new DomainError(
      "URL_NOT_ALLOWED",
      "Private or literal IP sources are not allowed",
      422,
    );
  return u;
}
export async function fetchPublicText(input: string) {
  let url = validateSourceUrl(input);
  for (let hop = 0; hop < 4; hop++) {
    const dns = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(url.hostname)}&type=A`,
    );
    const answer = (await dns.json()) as {
      Answer?: { type: number; data: string }[];
    };
    if (
      (answer.Answer || []).some(
        (a) =>
          a.type === 1 &&
          /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
            a.data,
          ),
      )
    )
      throw new DomainError(
        "URL_NOT_ALLOWED",
        "Private network destination blocked",
        422,
      );
    const res = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "text/plain,text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new DomainError("SOURCE_REDIRECT_INVALID");
      url = validateSourceUrl(new URL(next, url).href);
      continue;
    }
    if (!res.ok)
      throw new DomainError(
        "SOURCE_FETCH_FAILED",
        `Source returned HTTP ${res.status}`,
        422,
      );
    const length = Number(res.headers.get("content-length") || 0);
    if (length > 4 * 1024 * 1024)
      throw new DomainError("SOURCE_TOO_LARGE", "Source exceeds 4 MB", 422);
    const reader = res.body?.getReader();
    if (!reader) throw new DomainError("SOURCE_EMPTY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new DomainError("SOURCE_TOO_LARGE", "Source exceeds 4 MB", 422);
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    let text = new TextDecoder().decode(all);
    if (res.headers.get("content-type")?.includes("html"))
      text = text
        .replace(
          /<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,
          "",
        )
        .replace(/<\/(p|div|h[1-6]|li|article)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
    return normalizeText(text);
  }
  throw new DomainError(
    "SOURCE_TOO_MANY_REDIRECTS",
    "Too many source redirects",
    422,
  );
}
function textFromNodes(nodes: unknown[]): string {
  return nodes
    .map((n) => {
      const node = n as {
        paragraph?: { elements?: { textRun?: { content?: string } }[] };
        table?: { tableRows?: { tableCells?: { content?: unknown[] }[] }[] };
        tableOfContents?: { content?: unknown[] };
      };
      return node.paragraph
        ? (node.paragraph.elements || [])
            .map((e) => e.textRun?.content || "")
            .join("")
        : node.table
          ? (node.table.tableRows || [])
              .flatMap((r) => r.tableCells || [])
              .map((c) => textFromNodes(c.content || []))
              .join("\n")
          : node.tableOfContents
            ? textFromNodes(node.tableOfContents.content || [])
            : "";
    })
    .join("");
}
export async function googleDocument(env: Env, input: string) {
  const match = input.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/);
  if (!match)
    throw new DomainError("GOOGLE_URL_INVALID", "Use a Google Docs URL", 422);
  if (!env.GOOGLE_SERVICE_ACCOUNT)
    throw new DomainError(
      "GOOGLE_AUTH_REQUIRED",
      "This private Google document needs a connected service account. Export it as Word/PDF, paste its text, or ask the Studio administrator to connect Google Docs.",
      422,
    );
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT) as {
    client_email: string;
    private_key: string;
  };
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/documents.readonly",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(await importPKCS8(sa.private_key, "RS256"));
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token)
    throw new DomainError(
      "GOOGLE_AUTH_FAILED",
      "Google authorization failed",
      502,
    );
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${match[1]}?includeTabsContent=true`,
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  if (!res.ok)
    throw new DomainError(
      "GOOGLE_READ_FAILED",
      `Google Docs returned HTTP ${res.status}; verify document sharing`,
      422,
    );
  const d = (await res.json()) as {
    title: string;
    tabs?: unknown[];
    body?: { content?: unknown[] };
  };
  const flatten = (tabs: unknown[]): string[] =>
    tabs.flatMap((t) => {
      const tab = t as {
        documentTab?: { body?: { content?: unknown[] } };
        tabProperties?: { title?: string };
        childTabs?: unknown[];
      };
      return [
        `${tab.tabProperties?.title || ""}\n${textFromNodes(tab.documentTab?.body?.content || [])}`,
        ...flatten(tab.childTabs || []),
      ];
    });
  return {
    title: d.title,
    text: normalizeText(
      d.tabs
        ? flatten(d.tabs).join("\n\n")
        : textFromNodes(d.body?.content || []),
    ),
  };
}
