import { PublicClientApplication } from '@azure/msal-browser';

// Files.ReadWrite gir tilgang til Excel-filen i OneDrive via Graph.
// offline_access (refresh token) håndteres automatisk av MSAL.
export const GRAPH_SCOPES = ['Files.ReadWrite'];

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Appens redirect-URI – må registreres i Azure under SPA-plattformen. */
export function appRedirectUri(): string {
  return `${window.location.origin}${BASE}/`;
}

let instance: PublicClientApplication | null = null;
let instanceClientId = '';

/**
 * Oppretter (eller gjenbruker) MSAL-instansen for klient-ID-en fra
 * innstillingene. Instansen byttes ut hvis ID-en endres.
 */
export async function getMsal(clientId: string): Promise<PublicClientApplication> {
  if (!instance || instanceClientId !== clientId) {
    instance = new PublicClientApplication({
      auth: {
        clientId,
        authority: 'https://login.microsoftonline.com/common',
        redirectUri: appRedirectUri(),
        postLogoutRedirectUri: appRedirectUri(),
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false,
      },
    });
    await instance.initialize();
    instanceClientId = clientId;
  }
  return instance;
}
