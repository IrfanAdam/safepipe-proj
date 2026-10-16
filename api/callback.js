// safepipe — GitHub OAuth callback (Vercel serverless) · mirrors personal_website/api/callback.js
// Exchanges code for a token, hands it to the opener via postMessage (popup
// flow) or stashes it in sessionStorage and returns to /changelog.html
// (same-window flow). The token never touches the repo or the build.
export default async function handler(req, res) {
  const code = req.query.code;
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET;

  if (!code) {
    res.status(400).send('Missing code');
    return;
  }
  if (!clientId || !clientSecret) {
    res.status(500).send('Missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET env vars in Vercel.');
    return;
  }

  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await r.json();

    if (data.error || !data.access_token) {
      res.status(400).send(`OAuth error: ${data.error || 'no token'} - ${data.error_description || ''}`);
      return;
    }

    const token = data.access_token;
    const html = `<!doctype html>
<html><body><script>
(function() {
  var token = ${JSON.stringify(token)};
  var payload = JSON.stringify({ type: 'safepipe-oauth', token: token });
  if (window.opener) {
    try { window.opener.postMessage(payload, window.location.origin); } catch(e) {}
    document.body.innerHTML = '<p style="font-family:sans-serif;padding:40px;text-align:center">Signed in! Closing...</p>';
    setTimeout(function(){ window.close(); }, 800);
    return;
  }
  try { sessionStorage.setItem('safepipe-oauth-pending', token); } catch(e) {}
  window.location.href = '/changelog.html';
})();
<\/script></body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    res.status(500).send('OAuth exchange failed');
  }
}
