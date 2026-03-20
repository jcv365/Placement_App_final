import {
    PublicClientApplication,
    type Configuration,
} from "@azure/msal-browser";

function resolveRedirectUri(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const explicitRedirect = process.env.NEXT_PUBLIC_AAD_REDIRECT_URI?.trim();
  if (explicitRedirect) {
    return explicitRedirect;
  }

  const { protocol, hostname, port } = window.location;
  if (hostname === "127.0.0.1" || hostname === "localhost") {
    const localPort = port ? `:${port}` : "";
    return `${protocol}//localhost${localPort}`;
  }

  return window.location.origin;
}

const config: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AAD_CLIENT_ID ?? "",
    authority: process.env.NEXT_PUBLIC_AAD_AUTHORITY ?? "",
    redirectUri: resolveRedirectUri(),
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "localStorage",
  },
};

let instance: PublicClientApplication | undefined;
let initialisePromise: Promise<PublicClientApplication> | undefined;

export function getMsalInstance(): PublicClientApplication {
  if (typeof window === "undefined") {
    throw new Error("MSAL can only be initialised in the browser");
  }

  if (!instance) {
    instance = new PublicClientApplication(config);
  }

  return instance;
}

export async function getInitialisedMsalInstance(): Promise<PublicClientApplication> {
  const msal = getMsalInstance();

  if (!initialisePromise) {
    initialisePromise = msal.initialize().then(() => msal);
  }

  return initialisePromise;
}
