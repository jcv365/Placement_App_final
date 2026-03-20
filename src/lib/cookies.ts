const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseBaseUrl(value?: string): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function isLocalHttp(url: URL): boolean {
  return url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname);
}

export function shouldUseSecureCookies(request?: Request): boolean {
  // Optional override for local troubleshooting or strict HTTPS enforcement.
  if (process.env.COOKIE_SECURE === "true") {
    return true;
  }

  if (process.env.COOKIE_SECURE === "false") {
    return false;
  }

  if (request) {
    try {
      const requestUrl = new URL(request.url);
      if (isLocalHttp(requestUrl)) {
        return false;
      }

      if (requestUrl.protocol === "https:") {
        return true;
      }
    } catch {
      // Ignore URL parsing issues and continue with fallback checks.
    }

    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")
      .map((value) => value.trim().toLowerCase())[0];
    if (forwardedProto === "https") {
      return true;
    }

    if (forwardedProto === "http") {
      return false;
    }
  }

  const appBaseUrl = parseBaseUrl(process.env.APP_BASE_URL);
  if (appBaseUrl) {
    if (isLocalHttp(appBaseUrl)) {
      return false;
    }

    return appBaseUrl.protocol === "https:";
  }

  return process.env.NODE_ENV === "production";
}
