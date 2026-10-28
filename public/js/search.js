// Directory search, kept in its own file so it can be tested.
//
// How a search works:
// 1. Everyday words and phrases are looked up in /content/words.json
//    ("welfare" -> Social Services, "lights shut off" -> utility help,
//    "beat me" -> Domestic Violence). A small typo in a listed word is
//    understood too ("food stampes", "methadon"). Filler words ("I need help
//    with my") are dropped.
// 2. Town and county names ("glens falls", "washington county") and cost
//    words ("free", "no insurance") are wishes, not needs: they move nearby
//    and free or low-cost help up, but never hide the rest.
// 3. Each matched dictionary entry and each remaining word is one "need".
//    A listing meets a need if it is in the entry's category, or a word in the
//    listing starts with the searched word ("rent" finds "rental").
// 4. Listings meeting the most needs come first, then the right kind of help,
//    then the place wish, then general help before specialists (unless the
//    search names the specialty), then the cost wish, then help inside the three
//    counties before offices outside them, then by where the words appear
//    (name > tags > category > description).
// 5. Only if nothing at all matches: allow small typos in other words
//    ("dentst"), and say "we're not sure" with category suggestions instead
//    of pretending.
// Plain old JavaScript on purpose (works on older phones). Text only; this
// file never touches the page.

(function (root) {
  'use strict';

  var FIELD_WEIGHTS = {
    name: 3, tags: 2, category: 1.5, organization: 1, town: 1,
    serves_counties: 0.8, medicaid_plans: 0.8, description: 0.7, eligibility: 0.5,
  };
  var DV = 'Domestic Violence';
  // Longest search the page reads; the rest of a pasted paragraph is ignored.
  // Long enough for a whole sentence ("…and he hits me"), so safety words at
  // the end still count. The "we're not sure" guessing (when nothing matches)
  // only looks at the first few words, since it is slow.
  var MAX_WORDS = 40;
  var MAX_FUZZY_TERMS = 3;
  var LOW_COST = ['Free', 'Sliding scale', 'Uninsured OK'];

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

  // Singular and plural count as the same word: "veteran" finds "veterans",
  // "dentists" finds "dentist", "glasses" finds "glass". Words ending in
  // ss, us or is ("glass", "bus", "crisis"), and short words, are left alone
  // when trimming, so "news" doesn't turn into "new".
  function samePlural(word, term) {
    if (word === term + 's' || word === term + 'es') return true;
    if (term.length < 5 || /(ss|us|is)$/.test(term)) return false;
    return term === word + 's' || term === word + 'es';
  }

  // `region` (optional, from /api/listings): { towns: { "Glens Falls": "Warren", … },
  // counties: ["Warren", …] }. Without it, places are plain words.
  function create(listings, dict, region) {
    dict = dict || {};
    region = region || {};
    var townCounty = region.towns || {};
    var filler = {};
    (dict.filler || []).forEach(function (w) { words(w).forEach(function (x) { filler[x] = true; }); });
    // Everyday words that are not typos of a listed word ("mediation" is not "medication").
    var notTypo = {};
    (dict.not_typos || []).forEach(function (w) { words(w).forEach(function (x) { notTypo[x] = true; }); });
    // Generic words ("apply", "benefits", "office"): searched only when nothing
    // else is; otherwise they just nudge listings that have them in the name.
    var weak = {};
    (dict.weak_words || []).forEach(function (w) { words(w).forEach(function (x) { weak[x] = true; }); });
    var specialistPhrases = (dict.specialist_words || []).map(norm).filter(Boolean);
    var costPhrases = (dict.cost_words || []).map(norm).filter(Boolean)
      .sort(function (a, b) { return b.length - a.length; });
    var entries = (dict.entries || []).map(function (e) {
      return {
        match: (e.match || []).map(norm).filter(Boolean)
          .sort(function (a, b) { return b.length - a.length; }), // longest phrase first
        categories: e.categories || [],
        also: (e.also || []).map(words).reduce(function (a, b) { return a.concat(b); }, []),
        note: e.note || '',
        safety: e.safety === true,
        // by_word: a listing with these words in its name or tags counts as
        // the right kind of help even if it's filed in another category.
        byWord: e.by_word === true,
      };
    });

    // Places: every town in the area and each county, longest name first
    // ("south glens falls" before "glens falls").
    var places = [];
    Object.keys(townCounty).forEach(function (t) { places.push({ phrase: norm(t), town: t, county: townCounty[t] }); });
    (region.counties || []).forEach(function (c) { if (c !== 'Regional') places.push({ phrase: norm(c), town: '', county: c }); });
    places.sort(function (a, b) { return b.phrase.length - a.phrase.length; });

    var vocabulary = {};
    var index = listings.map(function (l) {
      var all = [];
      var fields = Object.keys(FIELD_WEIGHTS).map(function (f) {
        var ws = words(Array.isArray(l[f]) ? l[f].join(' ') : l[f]);
        all = all.concat(ws);
        return [FIELD_WEIGHTS[f], ws];
      });
      all.forEach(function (w) { vocabulary[w] = true; });
      // Offices in a town outside the three counties come after local ones on ties.
      var away = Boolean(l.town) && Object.keys(townCounty).length > 0 && !townCounty[l.town];
      // Specialists (by name or search words) come after general help on ties.
      var own = ' ' + words(l.name).concat(words((l.tags || []).join(' '))).join(' ') + ' ';
      var specialty = specialistPhrases.filter(function (p) { return own.indexOf(' ' + p + ' ') !== -1; });
      return { listing: l, fields: fields, all: all, away: away, specialty: specialty };
    });

    // Best field weight for a word in a listing, or 0.
    // exact = whole words only (used for dictionary words, so "me" or "off"
    // don't match "medical" or "office"); a plural or singular still counts.
    function weightFor(entry, term, fuzzy, exact) {
      var best = 0;
      for (var i = 0; i < entry.fields.length; i++) {
        var pair = entry.fields[i];
        if (pair[1].some(function (w) { return (exact ? w === term : w.indexOf(term) === 0) || samePlural(w, term); })) best = Math.max(best, pair[0]);
        else if (fuzzy && pair[1].some(function (w) { return closeEnough(term, w); })) best = Math.max(best, pair[0] * 0.6);
      }
      return best;
    }

    // Longest phrases win: "ride to doctor" is a ride, not a doctor. Once an
    // entry matches, every query word in any of its phrases belongs to it.
    var candidates = [];
    entries.forEach(function (e) { e.match.forEach(function (m) { candidates.push({ entry: e, phrase: m }); }); });
    candidates.sort(function (a, b) { return b.phrase.split(' ').length - a.phrase.split(' ').length || b.phrase.length - a.phrase.length; });

    // A plural of a word from the everyday-words list counts as that word, so
    // "urgent cares" is understood like "urgent care", and a singular counts
    // as the listed plural ("food stamp" is "food stamps").
    var dictWord = {};
    candidates.forEach(function (c) { c.phrase.split(' ').forEach(function (w) { dictWord[w] = true; }); });
    costPhrases.forEach(function (p) { p.split(' ').forEach(function (w) { dictWord[w] = true; }); });
    // Words of safety entries (abuse, crisis) are never the result of a guess:
    // a typo must not switch on, or off, the safety handling.
    var safetyWord = {};
    candidates.forEach(function (c) { if (c.entry.safety) c.phrase.split(' ').forEach(function (w) { safetyWord[w] = true; }); });
    var dictList = Object.keys(dictWord).filter(function (w) { return w.length >= 5 && !safetyWord[w]; });
    var vocabList = Object.keys(vocabulary);
    // A word some listing uses, or starts with ("glass" in "glasses",
    // "poison" in "poisoning"), is a real word here and never "corrected".
    function knownWord(w) {
      if (vocabulary[w]) return true;
      for (var i = 0; i < vocabList.length; i++) if (vocabList[i].indexOf(w) === 0 || samePlural(vocabList[i], w)) return true;
      return false;
    }
    function toDictWord(w) {
      if (dictWord[w]) return w;
      if (w.length >= 4 && dictWord[w + 's']) return w + 's';
      if (w.length < 5 || /(ss|us|is)$/.test(w)) return w;
      // Try "s" before "es": "cares" is "care", not "car"; "glasses" is "glass".
      if (/s$/.test(w) && dictWord[w.slice(0, -1)]) return w.slice(0, -1);
      if (/es$/.test(w) && dictWord[w.slice(0, -2)]) return w.slice(0, -2);
      return w;
    }
    // One letter missing, one extra, or two neighbours swapped ("dentst",
    // "stampes", "depersion"); never one letter swapped for another, which
    // is how real words turn into other real words ("pills" and "bills").
    function typoOf(w, d) {
      if (w.length === d.length - 1 || w.length === d.length + 1) {
        var long = w.length > d.length ? w : d;
        var short = w.length > d.length ? d : w;
        for (var i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
        return false;
      }
      if (w.length !== d.length) return false;
      for (var j = 0; j < w.length - 1; j++) {
        if (w.charAt(j) !== d.charAt(j)) return w.charAt(j) === d.charAt(j + 1) && w.charAt(j + 1) === d.charAt(j) && w.slice(j + 2) === d.slice(j + 2);
      }
      return false;
    }
    // A small typo in an everyday word ("stampes", "methadon", "depresion"):
    // careful on purpose, since a wrong guess is worse than none. Only a word
    // of 6+ letters that no listing uses or starts with, one typing slip from
    // exactly one listed word with the same first two letters, never into a
    // safety word, and not in the not_typos list.
    function correctTypo(w) {
      if (w.length < 6 || dictWord[w] || filler[w] || notTypo[w] || safetyWord[w]) return w;
      // The start of exactly one listed word, a letter or two short ("methadon").
      var ends = dictList.filter(function (d) { return d.length - w.length >= 1 && d.length - w.length <= 2 && d.indexOf(w) === 0; });
      if (ends.length === 1) return ends[0];
      if (knownWord(w)) return w;
      var best = null;
      var count = 0;
      for (var i = 0; i < dictList.length; i++) {
        var d = dictList[i];
        if (d.charAt(0) !== w.charAt(0) || d.charAt(1) !== w.charAt(1)) continue;
        if (typoOf(w, d)) { best = d; count++; }
      }
      return count === 1 ? best : w;
    }

    // Finds place or cost phrases and returns the other words, in order.
    // Only the matched words themselves are taken out ("not insured and not
    // safe" keeps the second "not", so "not safe" still means safety).
    function takePhrases(q, list) {
      var tokens = q ? q.split(' ') : [];
      var taken = [];
      var found = [];
      list.forEach(function (c) {
        var phrase = (c.phrase || c).split(' ');
        for (var i = 0; i + phrase.length <= tokens.length; i++) {
          var j;
          for (j = 0; j < phrase.length; j++) if (taken[i + j] || tokens[i + j] !== phrase[j]) break;
          if (j === phrase.length) {
            found.push(c);
            for (j = 0; j < phrase.length; j++) taken[i + j] = true;
            return;
          }
        }
      });
      return { found: found, rest: tokens.filter(function (w, i) { return !taken[i]; }).join(' ') };
    }

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

    // 2 = in the town named (or in the county named), 1 = serves that county,
    // 0.5 = serves the whole region, 0 = elsewhere.
    function placeScore(entry, place) {
      var l = entry.listing;
      var serves = l.serves_counties || [];
      if (place.town ? l.town === place.town : townCounty[l.town] === place.county) return 2;
      if (serves.indexOf(place.county) !== -1) return 1;
      return serves.indexOf('Regional') !== -1 ? 0.5 : 0;
    }

    function costScore(l) {
      var cost = l.cost || [];
      if (cost.some(function (c) { return LOW_COST.indexOf(c) !== -1; })) return 1;
      return cost.length ? -1 : 0; // insurance or private pay only
    }

    function search(query) {
      var raw = norm(query).split(' ').slice(0, MAX_WORDS).join(' ');
      if (!raw) return { results: listings.slice(), mode: 'all', notes: [], suggestions: [], safety: false };
      // A search in quotes ("mediation") is taken exactly as typed.
      var exact = /^\s*["“”]/.test(String(query));
      var plain = raw.split(' ').map(toDictWord).join(' ');
      var q = exact ? plain : plain.split(' ').map(correctTypo).join(' ');
      var corrected = q !== plain ? q : '';

      // Place and cost wishes come out first (no town name is also an
      // everyday-words phrase today; check that when adding either).
      var placeFind = takePhrases(q, places);
      var wanted = placeFind.found;
      var costFind = takePhrases(placeFind.rest, costPhrases);
      var rest = costFind.rest;
      var found = findEntries(rest);
      var termsOf = function (text) {
        return text ? text.split(' ').filter(function (w, i, a) { return !filler[w] && !found.used[w] && a.indexOf(w) === i; }) : [];
      };
      var allTerms = termsOf(rest);
      var terms = allTerms.filter(function (w) { return !weak[w]; });
      // Only generic words ("benefits"): search them after all.
      if (!found.hits.length && !terms.length && !wanted.length) terms = allTerms;
      var weakWords = allTerms.filter(function (w) { return weak[w] && terms.indexOf(w) === -1; });
      var wantsLowCost = costFind.found.length > 0;
      // Only a cost word ("no insurance", "uninsured"): its everyday meaning
      // (clinics) still applies, with free and low-cost places first.
      if (wantsLowCost && !found.hits.length && !terms.length && !wanted.length) {
        found = findEntries(q);
        terms = termsOf(q).filter(function (w) { return !weak[w]; });
      }
      var notes = [];
      var safety = false;
      found.hits.forEach(function (h) {
        if (h.entry.note && notes.indexOf(h.entry.note) === -1) notes.push(h.entry.note);
        if (h.entry.safety) safety = true;
      });
      var needs = found.hits.length + terms.length;
      // Only a place ("hudson falls"): the place is the need.
      var placeOnly = !needs && wanted.length > 0;
      if (!needs && !placeOnly) {
        return { results: wantsLowCost ? rankAll() : listings.slice(), mode: 'all', notes: notes, suggestions: [], safety: safety, lowCost: wantsLowCost, corrected: corrected, places: [] };
      }

      function rankAll() {
        return index.map(function (e) { return { entry: e, c: costScore(e.listing) }; })
          .sort(function (a, b) { return b.c - a.c || a.entry.listing.name.localeCompare(b.entry.listing.name); })
          .map(function (x) { return x.entry.listing; });
      }

      function rank(fuzzy) {
        var scored = [];
        index.forEach(function (entry) {
          var met = 0;
          var byCategory = 0;
          var dvSafe = 0;
          var score = 0;
          found.hits.forEach(function (h) {
            var e = h.entry;
            var catAt = e.categories.indexOf(entry.listing.category);
            var dictWords = e.also.concat(h.phrase.split(' ')).filter(function (t) { return t.length > 2 && !filler[t] && !weak[t]; });
            // A dictionary word in the listing's name counts more than one in its description.
            var wordWeight = fuzzy ? 0 : dictWords.reduce(function (m, t) { return Math.max(m, weightFor(entry, t, false, true)); }, 0);
            var byWord = e.byWord && wordWeight >= FIELD_WEIGHTS.tags;
            if (catAt !== -1 || wordWeight) {
              met++;
              if (catAt !== -1 || byWord) byCategory++;
              if (e.safety && entry.listing.category === DV && catAt !== -1) dvSafe = 1;
              score += (catAt !== -1 ? 3 - Math.min(catAt, 2) * 0.5 : byWord ? 3 : 0) + (wordWeight ? 1 + wordWeight : 0);
            }
          });
          (fuzzy ? terms.slice(0, MAX_FUZZY_TERMS) : terms).forEach(function (t) {
            var w = weightFor(entry, t, fuzzy);
            if (w) { met++; score += w; }
          });
          // Generic words in the name ("Social Security Office" for "office") still help a little.
          weakWords.forEach(function (t) { if (weightFor(entry, t, false) >= FIELD_WEIGHTS.tags) score += 1; });
          var place = 0;
          wanted.forEach(function (p) {
            place = Math.max(place, placeScore(entry, p));
            // The place's words in the listing's own name still count a little.
            if (weightFor(entry, p.phrase.split(' ')[0], false, true) === FIELD_WEIGHTS.name) score += 0.5;
          });
          if (placeOnly) { if (place < 1) return; met = 1; }
          if (met) {
            var special = entry.specialty.length && !entry.specialty.some(function (p) {
              var first = p.split(' ')[0];
              return q.split(' ').some(function (w) { return w.length >= 4 && first.indexOf(w) === 0; });
            });
            scored.push({ listing: entry.listing, met: met, byCategory: byCategory, dvSafe: dvSafe, place: place,
              cost: wantsLowCost ? costScore(entry.listing) : 0, special: special ? 1 : 0, score: score, away: entry.away ? 1 : 0 });
          }
        });
        scored.sort(function (a, b) {
          // A search about domestic violence: DV help that meets it comes first.
          if (safety && a.dvSafe !== b.dvSafe) return b.dvSafe - a.dvSafe;
          return b.met - a.met || b.byCategory - a.byCategory || b.place - a.place || a.special - b.special || b.cost - a.cost
            || a.away - b.away || b.score - a.score || a.listing.name.localeCompare(b.listing.name);
        });
        return scored;
      }

      var scored = rank(false);
      var mode;
      if (scored.length) {
        mode = placeOnly ? 'understood' : scored[0].met >= needs ? (found.hits.length ? 'understood' : 'exact') : 'partial';
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
        corrected: corrected,
        places: wanted.map(function (p) { return p.town || p.county + ' County'; }),
        lowCost: wantsLowCost,
      };
    }

    // `guess` is used by checks (test/search.test.js, scripts) to see which
    // words the typo guessing would change.
    return { search: search, guess: function (w) { return correctTypo(toDictWord(w)); } };
  }

  var api = { create: create, words: words };
  if (typeof window !== 'undefined') window.SADKSearch = api;
  else root.SADKSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
