import fs from 'fs';
import path from 'path';
import http from 'http';
import { randomBytes, createHash } from 'crypto';
import { spawn } from 'child_process';
import { google } from 'googleapis';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import '../config/env'; // Load .env without requiring unrelated report settings for sign-in.

export const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
];

export class AuthService {
  private static cachedClient: any = null;
  private static get credentialsPath(): string {
    return path.resolve(process.env.GOOGLE_CREDENTIALS_FILE || 'credentials.json');
  }
  private static get tokenPath(): string {
    return path.resolve(process.env.GOOGLE_TOKEN_FILE || 'token.json');
  }

  /**
   * Returns an authorized Google Auth client (OAuth2Client or ServiceAccount)
   */
  public static async getAuthClient(forceConsent = false): Promise<any> {
    if (this.cachedClient && !forceConsent) {
      return this.cachedClient;
    }

    if (!fs.existsSync(this.credentialsPath)) {
      throw new Error(
        `Credentials file not found at: ${this.credentialsPath}\n` +
        `Please ensure GOOGLE_CREDENTIALS_FILE in .env points to a valid Google Cloud OAuth Client or Service Account JSON file.`
      );
    }

    const credentialsRaw = fs.readFileSync(this.credentialsPath, 'utf8');
    const credentials = JSON.parse(credentialsRaw);

    // Case 1: Service Account Credentials
    if (credentials.type === 'service_account') {
      console.log('🔑 Authenticating using Google Service Account...');
      const auth = new google.auth.GoogleAuth({
        keyFile: this.credentialsPath,
        scopes: SCOPES,
      });
      this.cachedClient = await auth.getClient();
      console.log('Service accounts do not use browser consent or create token.json. Use Desktop app OAuth credentials for user sign-in.');
      return this.cachedClient;
    }

    // Case 2: OAuth 2.0 Client (installed app or web)
    const clientConfig = credentials.installed || credentials.web;
    if (!clientConfig) {
      throw new Error(
        'Invalid credentials.json format. Expected "installed", "web", or "service_account" definition.'
      );
    }

    const { client_id, client_secret, redirect_uris } = clientConfig;
    const redirectUri = credentials.installed ? 'http://127.0.0.1:0/oauth2callback' :
      redirect_uris?.find((uri: string) => {
        try {
          const url = new URL(uri);
          return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
        } catch { return false; }
      });
    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

    // Save newly refreshed tokens automatically
    oauth2Client.on('tokens', (tokens) => {
      try {
        let existingTokens: Record<string, any> = {};
        if (fs.existsSync(this.tokenPath)) {
          existingTokens = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
        }
        const updatedTokens = { ...existingTokens, ...tokens };
        fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
        fs.writeFileSync(this.tokenPath, JSON.stringify(updatedTokens, null, 2), 'utf8');
        console.log('🔄 Google OAuth2 tokens automatically refreshed and saved to token.json');
      } catch (err) {
        console.error('⚠️ Failed to save refreshed OAuth tokens:', err);
      }
    });

    // Check if token.json exists
    if (fs.existsSync(this.tokenPath) && !forceConsent) {
      console.log(`🔑 Loading cached OAuth2 tokens from: ${this.tokenPath}`);
      const tokenRaw = fs.readFileSync(this.tokenPath, 'utf8');
      const token = JSON.parse(tokenRaw);
      oauth2Client.setCredentials(token);
      this.cachedClient = oauth2Client;
      return oauth2Client;
    }

    if (!redirectUri) throw new Error('Use Desktop app OAuth credentials, or configure an HTTP localhost redirect URI in your web OAuth client.');
    console.log('Starting interactive Google authorization...');
    const authorizedClient = await this.promptForOAuthConsent(oauth2Client, redirectUri);
    this.cachedClient = authorizedClient;
    return authorizedClient;
  }

  /** Opens browser consent and receives Google's response on a local callback. */
  public static async promptForOAuthConsent(
    oauth2Client: OAuth2Client,
    redirectUri = 'http://127.0.0.1:0/oauth2callback'
  ): Promise<OAuth2Client> {
    const redirect = new URL(redirectUri);
    if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(redirect.hostname)) {
      throw new Error('OAuth sign-in requires an HTTP localhost redirect URI.');
    }
    const state = randomBytes(32).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return new Promise((resolve, reject) => {
      let handling = false;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        server.close();
        if (error) reject(error);
        else resolve(oauth2Client);
      };
      const server = http.createServer(async (req, res) => {
        const callback = new URL(req.url || '/', redirect.origin);
        if (callback.pathname !== redirect.pathname) {
          res.writeHead(404).end('Not found');
          return;
        }
        if (callback.searchParams.get('state') !== state) {
          res.writeHead(400).end('Invalid authorization state. Return to the original sign-in link.');
          return;
        }
        if (handling) { res.writeHead(409).end('Authorization already in progress.'); return; }
        handling = true;
        try {
          if (callback.searchParams.has('error')) throw new Error('Google authorization was denied. Run npm run auth:init to retry.');
          const code = callback.searchParams.get('code');
          if (!code) throw new Error('Google did not return an authorization code.');
          const { tokens } = await oauth2Client.getToken({ code, codeVerifier: verifier, redirect_uri: redirect.href });
          oauth2Client.setCredentials(tokens);
          fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
          fs.writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Authorization successful. You can close this tab and return to the terminal.');
          console.log('Authorization successful! Tokens saved to: ' + this.tokenPath);
          finish();
        } catch {
          res.writeHead(500).end('Authorization failed. Return to the terminal and retry sign-in.');
          finish(new Error('Google authorization failed. Check OAuth client settings and retry npm run auth:init.'));
        }
      });
      const timer = setTimeout(() => finish(new Error('Google sign-in timed out after 5 minutes. Run npm run auth:init to retry.')), 5 * 60 * 1000);
      server.once('error', error => finish(error));
      server.listen(redirect.port ? Number(redirect.port) : 80, redirect.hostname, () => {
        const address = server.address();
        if (!address || typeof address === 'string') { finish(new Error('Unable to start OAuth callback listener.')); return; }
        redirect.port = String(address.port);
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline', prompt: 'consent', scope: SCOPES,
          redirect_uri: redirect.href, state,
          code_challenge: challenge,
          code_challenge_method: CodeChallengeMethod.S256,
        });
        console.log('Opening Google sign-in in your browser. If it does not open, copy this URL:\n\n' + authUrl);
        console.log('Sign in and grant access. Keep this terminal open; token.json will be saved automatically.');
        this.openBrowser(authUrl);
      });
    });
  }

  private static openBrowser(url: string): void {
    const command = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env.BIRD_OAUTH_URL']
      : [url];
    const child = spawn(command, args, {
      windowsHide: true, stdio: 'ignore',
      env: { ...process.env, BIRD_OAUTH_URL: url },
    });
    child.on('error', () => console.warn('Could not open browser automatically. Open the URL printed above.'));
    child.on('exit', code => { if (code) console.warn('Browser launch failed. Open the URL printed above.'); });
    child.unref();
  }
}
