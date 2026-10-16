// safepipe — GitHub OAuth entry (Vercel serverless) · mirrors personal_website/api/auth.js
// Needs GITHUB_CLIENT_ID (+ GITHUB_CLIENT_SECRET for callback) in Vercel env,
// and https://<host>/api/callback registered on the GitHub OAuth app.
export default function handler(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.OAUTH_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('Missing GITHUB_CLIENT_ID env var. Set it in Vercel -> Settings -> Environment Variables.');
    return;
  }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;
  const redirectUri = `${origin}/api/callback`;
  // Identity + plan-file commits: read:user proves who they are, public_repo
  // lets /api/due commit the deadline to this repo's plan files as them —
  // no service token, no extra env. Re-login is needed to grant the scope.
  const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=read:user%20public_repo&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(302, url);
}
