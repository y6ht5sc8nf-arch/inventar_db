export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;

  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;

  // Secrets
  ANTHROPIC_API_KEY?: string;
  ALLOWED_EMAILS?: string;

  // Nur lokal (.dev.vars)
  DEV_ACCESS_EMAIL?: string;
}
