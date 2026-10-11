// Directory search, kept in its own file so it can be tested.
//
// How a search works:
// 1. Everyday words and phrases are looked up in /content/words.json
//    ("welfare" -> Social Services, "lights shut off" -> utility help,
//    "beat me" -> Domestic Violence). Filler words ("I need help with my")
//    are dropped.
// 2. Each matched dictionary entry and each remaining word is one "need".
//    A listing meets a need if it is in the entry's category, or a word in the
//    listing starts with the searched word ("rent" finds "rental").
// 3. Listings meeting the most needs come first, then by where the words
//    appear (name > tags > category > description).
// 4. Only if nothing at all matches: allow small typos ("dentst"), and say
//    "we're not sure" with category suggestions instead of pretending.
// Plain old JavaScript on purpose (works on older phones). Text only; this
// file never touches the page.

(function (root) {
  'use strict';

  var FIELD_WEIGHTS = {
    name: 3, tags: 2, category: 1.5, organization: 1, town: 1,
    serves_counties: 0.8, medicaid_plans: 0.8, description: 0.7, eligibility: 0.5,
  };

  function words(text) {
    var s = String(text == null ? '' : text).toLowerCase().replace(/['’]/g, '');
    if (s.normalize) s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return s.split(/[^a-z0-9]+/).filter(Boolean);
  }

  function norm(text) { return words(text).join(' '); }

  // Edit distance with swapped neighbours counting as one edit.
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [];
    var i;
    var j;
    for (i = 0; i <= a.length; i++) d.push([i]);
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      var rowMin = Infinity;
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        rowMin = Math.min(rowMin, d[i][j]);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  function closeEnough(term, word) {
    var max = term.length <= 3 ? 0 : term.length <= 6 ? 1 : 2;
    if (max === 0) return false;
    return [word, word.slice(0, term.length), word.slice(0, term.length + 1)].some(function (w) {
      return editDistance(term, w, max) <= max;
    });
  }

  function create(listings, dict) {
    dict = dict || {};
    var filler = {};
    (dict.filler || []).forEach(function (w) { words(w).forEach(function (x) { filler[x] = true; }); });
    var entries = (dict.entries || []).map(function (e) {
      return {
        match: (e.match || []).map(norm).filter(Boolean)
          .sort(function (a, b) { return b.length - a.length; }), // longest phrase first
        categories: e.categories || [],
        also: (e.also || []).map(words).reduce(function (a, b) { return a.concat(b); }, []),
        note: e.note || '',
        safety: e.safety === true,
      };
    });

    var index = listings.map(function (l) {
      var all = [];
      var fields = Object.keys(FIELD_WEIGHTS).map(function (f) {
        var ws = words(Array.isArray(l[f]) ? l[f].join(' ') : l[f]);
        all = all.concat(ws);
        return [FIELD_WEIGHTS[f], ws];
      });
      return { listing: l, fields: fields, all: all };
    });

    // Best field weight for a word in a listing, or 0.
    // exact = whole words only (used for dictionary words, so "me" or "off"
    // don't match "medical" or "office").
    function weightFor(entry, term, fuzzy, exact) {
      var best = 0;
      for (var i = 0; i < entry.fields.length; i++) {
        var pair = entry.fields[i];
        if (pair[1].some(function (w) { return exact ? w === term : w.indexOf(term) === 0; })) best = Math.max(best, pair[0]);
        else if (fuzzy && pair[1].some(function (w) { return closeEnough(term, w); })) best = Math.max(best, pair[0] * 0.6);
      }
      return best;
    }

    // Longest phrases win: "ride to doctor" is a ride, not a doctor. Once an
    // entry matches, every query word in any of its phrases belongs to it.
    var candidates = [];
    entries.forEach(function (e) { e.match.forEach(function (m) { candidates.push({ entry: e, phrase: m }); }); });
    candidates.sort(function (a, b) { return b.phrase.split(' ').length - a.phrase.split(' ').length || b.phrase.length - a.phrase.length; });

    function findEntries(q) {
      var padded = ' ' + q + ' ';
      var qWords = q.split(' ');
      var hits = [];
      var used = {};
      candidates.forEach(function (c) {
        if (hits.some(function (h) { return h.entry === c.entry; })) return;
        if (padded.indexOf(' ' + c.phrase + ' ') === -1) return;
        if (c.phrase.split(' ').some(function (w) { return used[w]; })) return;
        hits.push({ entry: c.entry, phrase: c.phrase });
        c.entry.match.forEach(function (m) {
          m.split(' ').forEach(function (w) { if (qWords.indexOf(w) !== -1) used[w] = true; });
        });
      });
      return { hits: hits, used: used };
    }

    function search(query) {
      var q = norm(query);
      if (!q) return { results: listings.slice(), mode: 'all', notes: [], suggestions: [], safety: false };
      var found = findEntries(q);
      var terms = q.split(' ').filter(function (w, i, a) { return !filler[w] && !found.used[w] && a.indexOf(w) === i; });
      var notes = [];
      var safety = false;
      found.hits.forEach(function (h) {
        if (h.entry.note && notes.indexOf(h.entry.note) === -1) notes.push(h.entry.note);
        if (h.entry.safety) safety = true;
      });
      var needs = found.hits.length + terms.length;
      if (!needs) return { results: listings.slice(), mode: 'all', notes: notes, suggestions: [], safety: safety };

      function rank(fuzzy) {
        var scored = [];
        index.forEach(function (entry) {
          var met = 0;
          var byCategory = 0;
          var score = 0;
          found.hits.forEach(function (h) {
            var e = h.entry;
            var catAt = e.categories.indexOf(entry.listing.category);
            var dictWords = e.also.concat(h.phrase.split(' ')).filter(function (t) { return t.length > 2 && !filler[t]; });
            // A dictionary word in the listing's name counts more than one in its description.
            var wordWeight = fuzzy ? 0 : dictWords.reduce(function (m, t) { return Math.max(m, weightFor(entry, t, false, true)); }, 0);
            if (catAt !== -1 || wordWeight) {
              met++;
              if (catAt !== -1) byCategory++;
              score += (catAt !== -1 ? 3 - Math.min(catAt, 2) * 0.5 : 0) + (wordWeight ? 1 + wordWeight : 0);
            }
          });
          terms.forEach(function (t) {
            var w = weightFor(entry, t, fuzzy);
            if (w) { met++; score += w; }
          });
          if (met) scored.push({ listing: entry.listing, met: met, byCategory: byCategory, score: score });
        });
        scored.sort(function (a, b) {
          if (safety) {
            var ad = a.listing.category === 'Domestic Violence' ? 1 : 0;
            var bd = b.listing.category === 'Domestic Violence' ? 1 : 0;
            if (ad !== bd) return bd - ad;
          }
          return b.met - a.met || b.byCategory - a.byCategory || b.score - a.score || a.listing.name.localeCompare(b.listing.name);
        });
        return scored;
      }

      var scored = rank(false);
      var mode;
      if (scored.length) {
        mode = scored[0].met >= needs ? (found.hits.length ? 'understood' : 'exact') : 'partial';
      } else {
        scored = terms.length ? rank(true) : [];
        mode = scored.length ? 'unsure' : 'none';
      }
      // Suggest categories: from the dictionary when it understood the words,
      // otherwise from the closest guesses.
      var suggestions = [];
      found.hits.forEach(function (h) { h.entry.categories.forEach(function (c) { if (suggestions.indexOf(c) === -1) suggestions.push(c); }); });
      if (mode === 'unsure') {
        scored.forEach(function (s) { var c = s.listing.category; if (c && suggestions.indexOf(c) === -1) suggestions.push(c); });
      }
      return {
        results: scored.map(function (s) { return s.listing; }),
        mode: mode,
        notes: notes.slice(0, 2),
        suggestions: suggestions.slice(0, 4),
        safety: safety,
        needs: needs,
      };
    }

    return { search: search };
  }

  var api = { create: create, words: words };
  if (typeof window !== 'undefined') window.SADKSearch = api;
  else root.SADKSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
