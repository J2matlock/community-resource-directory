// Admin check (project rule 3). Every admin route and every write calls this.
// Verifies the Cloudflare Access token's signature, issuer (team domain) and
// audience (AUD tag), then compares its email to the ADMIN_EMAIL setting.
// Fails closed: any missing setting or bad token means "not the admin".

import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();

function keySetFor(teamDomain) {
  let jwks = keySets.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    keySets.set(teamDomain, jwks);
  }
  return jwks;
}

/** Returns { email } for the owner, or null for anyone else. */
export async function getAdmin(request, env) {
  const teamDomain = (env.TEAM_DOMAIN || '').replace(/\/+$/, '');
  const audience = env.POLICY_AUD || '';
  const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const token = request.headers.get('Cf-Access-Jwt-Assertion');

  // Local test mode for `npm run dev` on the owner's computer. LOCAL_DEV_ADMIN
  // lives only in .dev.vars (never uploaded), and it works only for requests
  // to localhost, which the live site can never receive.
  if (env.LOCAL_DEV_ADMIN === 'true' && adminEmail) {
    const host = new URL(request.url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return { email: adminEmail };
  }

  if (!teamDomain.startsWith('https://') || !audience || !adminEmail || !token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, keySetFor(teamDomain), {
      issuer: teamDomain,
      audience,
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    return email && email === adminEmail ? { email } : null;
  } catch {
    return null;
  }
}

export async function isAdmin(request, env) {
  return (await getAdmin(request, env)) !== null;
}
