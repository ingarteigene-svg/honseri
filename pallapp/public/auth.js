// Innlogging med Microsoft 365 (Entra ID) via MSAL.js – samme konto som OneDrive.
// Bare brukere i gårdens Microsoft 365-organisasjon kan logge inn, og bare de som
// er tildelt appen i Entra ID og har fått Excel-filen delt med seg, kommer videre.

import { AuthExpiredError } from './excel.js';

const SCOPES = ['Files.ReadWrite.All'];

/**
 * Returnerer { user, getToken, login, logout }. Kan omdirigere til Microsofts
 * påloggingsside; da returnerer funksjonen aldri (siden lastes på nytt etterpå).
 */
export async function initAuth(cfg) {
  if (cfg.dev) {
    // Kun lokal utvikling (npm run dev): ingen Microsoft-innlogging.
    const user = new URLSearchParams(location.search).get('bruker') || cfg.dev.user;
    return { user, getToken: async () => 'dev-token', login() { location.reload(); }, logout() {} };
  }

  const msal = window.msal;
  const redirectUri = cfg.redirectUri || new URL('./', location.href).href;
  const pca = new msal.PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri,
      navigateToLoginRequestUrl: true,
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  const res = await pca.handleRedirectPromise();
  const account = res?.account || pca.getActiveAccount() || pca.getAllAccounts()[0];

  const login = () => pca.loginRedirect({ scopes: SCOPES, redirectStartPage: location.href });

  if (!account) {
    await login();
    return new Promise(() => {});
  }
  pca.setActiveAccount(account);

  async function getToken() {
    try {
      const r = await pca.acquireTokenSilent({ scopes: SCOPES, account });
      return r.accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError || /interaction_required|login_required|consent_required/.test(e?.errorCode || '')) {
        throw new AuthExpiredError('Innloggingen må fornyes.');
      }
      throw e;
    }
  }

  return {
    user: (account.username || '').toLowerCase(),
    getToken,
    login: () => pca.acquireTokenRedirect({ scopes: SCOPES, account, redirectStartPage: location.href }),
    logout: () => pca.logoutRedirect({ account }),
  };
}
