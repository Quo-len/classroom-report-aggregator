import fs from 'fs';
import readline from 'readline';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';

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

  /**
   * Returns an authorized Google Auth client (OAuth2Client or ServiceAccount)
   */
  public static async getAuthClient(): Promise<any> {
    if (this.cachedClient) {
      return this.cachedClient;
    }

    if (!fs.existsSync(env.credentialsPath)) {
      throw new Error(
        `Credentials file not found at: ${env.credentialsPath}\n` +
        `Please ensure GOOGLE_CREDENTIALS_FILE in .env points to a valid Google Cloud OAuth Client or Service Account JSON file.`
      );
    }

    const credentialsRaw = fs.readFileSync(env.credentialsPath, 'utf8');
    const credentials = JSON.parse(credentialsRaw);

    // Case 1: Service Account Credentials
    if (credentials.type === 'service_account') {
      console.log('🔑 Authenticating using Google Service Account...');
      const auth = new google.auth.GoogleAuth({
        keyFile: env.credentialsPath,
        scopes: SCOPES,
      });
      this.cachedClient = await auth.getClient();
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
    const redirectUri = redirect_uris && redirect_uris.length > 0 ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob';
    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

    // Save newly refreshed tokens automatically
    oauth2Client.on('tokens', (tokens) => {
      try {
        let existingTokens: Record<string, any> = {};
        if (fs.existsSync(env.tokenPath)) {
          existingTokens = JSON.parse(fs.readFileSync(env.tokenPath, 'utf8'));
        }
        const updatedTokens = { ...existingTokens, ...tokens };
        fs.writeFileSync(env.tokenPath, JSON.stringify(updatedTokens, null, 2), 'utf8');
        console.log('🔄 Google OAuth2 tokens automatically refreshed and saved to token.json');
      } catch (err) {
        console.error('⚠️ Failed to save refreshed OAuth tokens:', err);
      }
    });

    // Check if token.json exists
    if (fs.existsSync(env.tokenPath)) {
      console.log(`🔑 Loading cached OAuth2 tokens from: ${env.tokenPath}`);
      const tokenRaw = fs.readFileSync(env.tokenPath, 'utf8');
      const token = JSON.parse(tokenRaw);
      oauth2Client.setCredentials(token);
      this.cachedClient = oauth2Client;
      return oauth2Client;
    }

    console.warn(`⚠️ Token file not found at ${env.tokenPath}. Starting interactive authorization...`);
    const authorizedClient = await this.promptForOAuthConsent(oauth2Client);
    this.cachedClient = authorizedClient;
    return authorizedClient;
  }

  /**
   * Prompts user via terminal to open authorization URL and enter verification code
   */
  public static async promptForOAuthConsent(oauth2Client: OAuth2Client): Promise<OAuth2Client> {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    console.log('\n================== GOOGLE AUTHORIZATION REQUIRED ==================');
    console.log('1. Open this URL in your browser:\n');
    console.log(authUrl);
    console.log('\n2. Sign in with your institutional Google account and grant permissions.');
    console.log('3. Copy the authorization code provided and paste it below:');
    console.log('===================================================================\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve, reject) => {
      rl.question('Enter authorization code (or paste the entire redirect URL): ', async (rawInput) => {
        rl.close();
        try {
          let code = rawInput.trim();
          if (code.includes('code=')) {
            try {
              const parsedUrl = new URL(code.startsWith('http') ? code : `http://${code}`);
              const extracted = parsedUrl.searchParams.get('code');
              if (extracted) {
                code = extracted;
                console.log('🔍 Extracted authorization code from redirect URL.');
              }
            } catch (_) {}
          }

          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);
          fs.writeFileSync(env.tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
          console.log(`✅ Authorization successful! Tokens saved to: ${env.tokenPath}`);
          resolve(oauth2Client);
        } catch (error) {
          console.error('❌ Error retrieving access token:', error);
          reject(error);
        }
      });
    });
  }
}
