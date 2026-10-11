// Admin API. Reached only after getAdmin() succeeded in src/index.js; each
// handler also refuses to run without an admin (defense in depth).

import { COUNTIES } from '../lib/listing-rules.js';
import { json, notFound, readJson } from '../http.js';
import {
  UserError, listAllListings, getListing, getHistory, createListing, updateListing,
  markVerified, setRetired, dueForRecheck, getManagedList, addListItem, renameListItem, deleteListItem,
  exportSheets, todayLocal, listRequests, markRequestHandled,
} from '../db/admin.js';
import { buildXlsx } from '../xlsx.js';
import { getNotice, saveNotice } from '../db/notice.js';
import { validateNotice } from '../validate.js';

const LIST_KINDS = ['categories', 'plans'];

export async function handleAdminApi(request, env, url, admin) {
  if (!admin?.email) return json({ error: 'Not available.' }, 403);
  const db = env.DB;
  const who = admin.email;
  const method = request.method;
  let parts;
  try {
    parts = url.pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return json({ error: 'Bad address.' }, 400);
  }

  try {
    if (parts[0] === 'whoami' && method === 'GET') return json({ email: who });

    if (parts[0] === 'listings') {
      if (parts.length === 1) {
        if (method === 'GET') return json({ listings: await listAllListings(db) });
        if (method === 'POST') {
          const { body, error } = await readJson(request);
          if (error) return error;
          return json({ listing: await createListing(db, body, who) }, 201);
        }
      }
      if (parts.length === 2) {
        const id = parts[1];
        if (method === 'GET') {
          const listing = await getListing(db, id);
          if (!listing) return notFound(url.pathname);
          return json({ listing, history: await getHistory(db, id) });
        }
        if (method === 'PUT') {
          const { body, error } = await readJson(request);
          if (error) return error;
          return json({ listing: await updateListing(db, id, body, who) });
        }
      }
      if (parts.length === 3 && method === 'POST') {
        const [, id, action] = parts;
        if (action === 'verify') return json({ listing: await markVerified(db, id, who) });
        if (action === 'retire') return json({ listing: await setRetired(db, id, true, who) });
        if (action === 'restore') return json({ listing: await setRetired(db, id, false, who) });
      }
    }

    if (parts[0] === 'export' && parts.length === 1 && method === 'GET') {
      const file = buildXlsx(await exportSheets(db));
      return new Response(file, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="resource-directory-${todayLocal()}.xlsx"`,
        },
      });
    }

    if (parts[0] === 'region' && parts.length === 1 && method === 'GET') {
      return json({ counties: COUNTIES });
    }

    if (parts[0] === 'barriers' && parts.length === 1 && method === 'GET') {
      const { results } = await db.prepare('SELECT id, county, barriers, reporter, comment, created_at FROM barrier_reports ORDER BY id DESC LIMIT 500').all();
      const parse = (t) => { try { const a = JSON.parse(t || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
      return json({ reports: results.map((r) => ({ ...r, barriers: parse(r.barriers) })) });
    }

    if (parts[0] === 'notice' && parts.length === 1) {
      if (method === 'GET') return json({ notice: await getNotice(db) });
      if (method === 'PUT') {
        const { body, error } = await readJson(request);
        if (error) return error;
        const { value, errors } = validateNotice(body);
        if (!value) return json({ error: 'Please check the notice.', errors }, 422);
        return json({ notice: await saveNotice(db, value) });
      }
    }

    if (parts[0] === 'suggestions' && parts.length === 1 && method === 'GET') {
      const { results } = await db.prepare('SELECT id, looking_for, county, created_at FROM help_suggestions ORDER BY id DESC LIMIT 500').all();
      return json({ suggestions: results });
    }

    if (parts[0] === 'requests') {
      if (parts.length === 1 && method === 'GET') return json({ requests: await listRequests(db) });
      if (parts.length === 3 && parts[2] === 'handled' && method === 'POST') {
        const { body, error } = await readJson(request);
        if (error) return error;
        await markRequestHandled(db, parts[1], body?.note);
        return json({ ok: true });
      }
    }

    if (parts[0] === 'recheck' && parts.length === 1 && method === 'GET') {
      return json({ listings: await dueForRecheck(db) });
    }

    if (parts[0] === 'lists' && LIST_KINDS.includes(parts[1])) {
      const kind = parts[1];
      if (parts.length === 2) {
        if (method === 'GET') return json({ items: await getManagedList(db, kind) });
        if (method === 'POST') {
          const { body, error } = await readJson(request);
          if (error) return error;
          return json({ items: await addListItem(db, kind, body?.name) }, 201);
        }
      }
      if (parts.length === 3) {
        if (method === 'PUT') {
          const { body, error } = await readJson(request);
          if (error) return error;
          return json({ items: await renameListItem(db, kind, parts[2], body?.name, who) });
        }
        if (method === 'DELETE') return json({ items: await deleteListItem(db, kind, parts[2]) });
      }
    }

    return notFound(url.pathname);
  } catch (err) {
    if (err instanceof UserError) return json(err.body, err.status);
    throw err;
  }
}
