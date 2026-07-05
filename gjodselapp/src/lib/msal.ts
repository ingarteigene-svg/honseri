import { PublicClientApplication } from '@azure/msal-browser';

// Files.ReadWrite gir tilgang til Excel-filen i OneDrive via Graph.
// offline_access (refresh token) håndteres automatisk av MSAL.
export const GRAPH_SCOPES = ['Files.ReadWrite'];

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
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
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
