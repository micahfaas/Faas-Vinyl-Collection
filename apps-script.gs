/**
 * Faas Vinyl Collection — Google Apps Script backend
 * ─────────────────────────────────────────────────────
 * Sheet columns:
 *   A: Artist
 *   B: Album
 *   C: Genre (comma-separated for multi-genre)
 *   D: Favorite (TRUE/FALSE)
 *   E: ArtUrl
 *   F: TerranautCandidate (TRUE/FALSE)
 *   G: PlayedAtTerranautDates (comma-separated ISO dates, e.g. "2026-03-12, 2026-04-09")
 *   H: Wishlist (TRUE/FALSE)
 *   I: Notes (free text)
 *   J: Tracklist (JSON cache from Discogs — DO NOT hand-edit)   ← NEW
 *
 * Row 1 is the header row. All data starts at row 2.
 * New records are INSERTED at row 2 (not appended) to keep newest-first ordering.
 *
 * NEW IN THIS VERSION (Task 2):
 *   - `getTracklist` POST action: returns the cached tracklist for a row
 *     (column J), or fetches it from Discogs (Vinyl release), caches it,
 *     and returns it. Discogs is proxied here — never called from the browser.
 *   - Requires a Discogs personal token in Script Properties as DISCOGS_TOKEN.
 */

const SHEET_NAME = 'Sheet1';
const HEADER_ROW = 1;
const NUM_DATA_COLS = 9;   // A–I: the album fields returned by doGet
const COL_TRACKLIST = 10;  // column J: Discogs tracklist JSON cache

// ── GET: returns the full collection ────────────────────────────────
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow <= HEADER_ROW) {
    return jsonResponse({ albums: [] });
  }

  const range = sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, NUM_DATA_COLS);
  const values = range.getValues();

  const albums = values.map((row, i) => {
    const rowIndex = i + HEADER_ROW + 1; // 1-based sheet row

    // Parse genres: comma-separated → array
    const genresRaw = String(row[2] || '').trim();
    const genres = genresRaw
      ? genresRaw.split(',').map(g => g.trim()).filter(Boolean)
      : [];

    // Parse played dates: comma-separated → array (newest first)
    const datesRaw = String(row[6] || '').trim();
    const playedDates = datesRaw
      ? datesRaw.split(',').map(d => normalizeDate(d.trim())).filter(Boolean)
      : [];
    // Sort newest first
    playedDates.sort((a, b) => b.localeCompare(a));

    return {
      artist:               String(row[0] || ''),
      album:                String(row[1] || ''),
      genres:               genres,
      favorite:             toBool(row[3]),
      artUrl:               String(row[4] || ''),
      terranautCandidate:   toBool(row[5]),
      playedDates:          playedDates,
      wishlist:             toBool(row[7]),
      notes:                String(row[8] || ''),
      rowIndex:             rowIndex
    };
  }).filter(a => a.artist || a.album); // skip blank rows

  return jsonResponse({ albums: albums });
}

// ── POST: dispatches to action handlers ─────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'addAlbum')         return addAlbum(body);
    if (action === 'updateAlbum')      return updateAlbum(body);
    if (action === 'deleteAlbum')      return deleteAlbum(body);
    if (action === 'toggleFavorite')   return toggleFavorite(body);
    if (action === 'updateArt')        return updateArt(body);
    if (action === 'getTracklist')     return getTracklist(body);    // ← NEW (Task 2)
    if (action === 'searchByBarcode')  return searchByBarcode(body); // ← NEW (Task 3)

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── ACTION: addAlbum ────────────────────────────────────────────────
// Inserts a new row at row 2 (just below the header).
function addAlbum(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  sheet.insertRowBefore(HEADER_ROW + 1);

  const newRow = HEADER_ROW + 1;
  const row = [
    body.artist || '',
    body.album || '',
    body.genres || '',                                // already a string (comma-separated)
    body.favorite ? true : false,
    body.artUrl || '',
    body.terranautCandidate ? true : false,
    body.playedDates || '',                           // comma-separated string
    body.wishlist ? true : false,
    body.notes || ''
  ];

  sheet.getRange(newRow, 1, 1, NUM_DATA_COLS).setValues([row]);

  // Clear header formatting from the new row
  const r = sheet.getRange(newRow, 1, 1, NUM_DATA_COLS);
  r.setBackground(null);
  r.setFontColor(null);
  r.setFontWeight('normal');
  r.setFontSize(10);

  return jsonResponse({ success: true, rowIndex: newRow });
}

// ── ACTION: updateAlbum ─────────────────────────────────────────────
// Generic update for any combination of fields on an existing row.
// Body fields that are present overwrite the cell; absent fields are left alone.
// NOTE: when artist/album change, the cached tracklist (col J) is cleared so it
// gets re-fetched for the new album on next open.
function updateAlbum(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const rowIndex = body.rowIndex;
  if (!rowIndex || rowIndex < HEADER_ROW + 1) {
    return jsonResponse({ error: 'Invalid rowIndex' });
  }

  if (body.hasOwnProperty('artist'))               sheet.getRange(rowIndex, 1).setValue(body.artist);
  if (body.hasOwnProperty('album'))                sheet.getRange(rowIndex, 2).setValue(body.album);
  if (body.hasOwnProperty('genres'))               sheet.getRange(rowIndex, 3).setValue(body.genres);
  if (body.hasOwnProperty('favorite'))             sheet.getRange(rowIndex, 4).setValue(body.favorite ? true : false);
  if (body.hasOwnProperty('artUrl'))               sheet.getRange(rowIndex, 5).setValue(body.artUrl);
  if (body.hasOwnProperty('terranautCandidate'))   sheet.getRange(rowIndex, 6).setValue(body.terranautCandidate ? true : false);
  if (body.hasOwnProperty('playedDates'))          sheet.getRange(rowIndex, 7).setValue(body.playedDates);
  if (body.hasOwnProperty('wishlist'))             sheet.getRange(rowIndex, 8).setValue(body.wishlist ? true : false);
  if (body.hasOwnProperty('notes'))                sheet.getRange(rowIndex, 9).setValue(body.notes);

  // If the album identity changed, the cached tracklist is stale — clear it.
  if (body.hasOwnProperty('artist') || body.hasOwnProperty('album')) {
    sheet.getRange(rowIndex, COL_TRACKLIST).clearContent();
  }

  return jsonResponse({ success: true });
}

// ── ACTION: deleteAlbum ─────────────────────────────────────────────
function deleteAlbum(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const rowIndex = body.rowIndex;
  if (!rowIndex || rowIndex < HEADER_ROW + 1) {
    return jsonResponse({ error: 'Invalid rowIndex' });
  }
  sheet.deleteRow(rowIndex);
  return jsonResponse({ success: true });
}

// ── ACTION: toggleFavorite (kept for backwards compat) ──────────────
function toggleFavorite(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  sheet.getRange(body.rowIndex, 4).setValue(body.favorite ? true : false);
  return jsonResponse({ success: true });
}

// ── ACTION: updateArt ───────────────────────────────────────────────
function updateArt(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  sheet.getRange(body.rowIndex, 5).setValue(body.artUrl);
  return jsonResponse({ success: true });
}

// ── ACTION: getTracklist ────────────────────────────────────────────
// Returns the cached tracklist for a row (column J), or fetches it from
// Discogs (Vinyl release), caches it as JSON, and returns it.
// Response: { tracklist: [{position, title, duration}], cached: bool }
function getTracklist(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const rowIndex = body.rowIndex;

  // 1) Try the cache in column J
  if (rowIndex && rowIndex >= HEADER_ROW + 1) {
    const cached = String(sheet.getRange(rowIndex, COL_TRACKLIST).getValue() || '').trim();
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.length) {
          return jsonResponse({ tracklist: parsed, cached: true });
        }
      } catch (err) { /* corrupt cache → fall through and refetch */ }
    }
  }

  // 2) Fetch from Discogs
  const artist = String(body.artist || '').trim();
  const album  = String(body.album || '').trim();
  if (!artist && !album) return jsonResponse({ tracklist: [] });

  const tracklist = fetchDiscogsTracklist(artist, album);

  // 3) Cache only non-empty results, so "not found" can be retried later.
  if (tracklist.length && rowIndex && rowIndex >= HEADER_ROW + 1) {
    sheet.getRange(rowIndex, COL_TRACKLIST).setValue(JSON.stringify(tracklist));
  }

  return jsonResponse({ tracklist: tracklist, cached: false });
}

// ── ACTION: searchByBarcode ─────────────────────────────────────────
// Discogs barcode lookup (prefers Vinyl). Returns the exact release for
// pre-filling the Add form:
//   { found, barcode, artist, album, artUrl, genres:[], tracklist:[...] }
function searchByBarcode(body) {
  const barcode = String(body.barcode || '').replace(/\s+/g, '').trim();
  if (!barcode) return jsonResponse({ found: false });

  const token = PropertiesService.getScriptProperties().getProperty('DISCOGS_TOKEN');
  if (!token) throw new Error('DISCOGS_TOKEN not set in Script Properties');

  // 1) Search by barcode, preferring Vinyl
  let search = discogsFetch(
    'https://api.discogs.com/database/search?type=release&format=Vinyl'
    + '&barcode=' + encodeURIComponent(barcode) + '&per_page=5&page=1', token);

  // Fallback: any format if no vinyl pressing is indexed under this barcode
  if (!search || !search.results || !search.results.length) {
    search = discogsFetch(
      'https://api.discogs.com/database/search?type=release'
      + '&barcode=' + encodeURIComponent(barcode) + '&per_page=5&page=1', token);
  }
  if (!search || !search.results || !search.results.length) {
    return jsonResponse({ found: false, barcode: barcode });
  }

  // 2) Fetch the full release
  const releaseId = search.results[0].id;
  const release = releaseId ? discogsFetch('https://api.discogs.com/releases/' + releaseId, token) : null;
  if (!release) return jsonResponse({ found: false, barcode: barcode });

  // Artist: join names, strip Discogs "(2)" disambiguation suffixes
  let artist = '';
  if (release.artists && release.artists.length) {
    artist = release.artists
      .map(a => String(a.name || '').replace(/\s*\(\d+\)$/, '').trim())
      .filter(Boolean)
      .join(', ');
  }
  const album = String(release.title || '');

  // Art: primary image (else first), else the search result cover; force https
  let artUrl = '';
  if (release.images && release.images.length) {
    const primary = release.images.filter(im => im.type === 'primary')[0] || release.images[0];
    artUrl = String(primary.uri || primary.resource_url || '');
  }
  if (!artUrl && search.results[0].cover_image) artUrl = String(search.results[0].cover_image);
  artUrl = artUrl.replace(/^http:/, 'https:');

  // Genres: prefer styles (more specific), else genres
  let genres = [];
  if (release.styles && release.styles.length)      genres = release.styles.slice();
  else if (release.genres && release.genres.length) genres = release.genres.slice();

  // Tracklist (same mapping as getTracklist)
  const tracklist = (release.tracklist || [])
    .filter(t => !t.type_ || t.type_ === 'track')
    .map(t => ({
      position: String(t.position || ''),
      title:    String(t.title || ''),
      duration: String(t.duration || '')
    }))
    .filter(t => t.title);

  return jsonResponse({
    found:     true,
    barcode:   barcode,
    artist:    artist,
    album:     album,
    artUrl:    artUrl,
    genres:    genres,
    tracklist: tracklist
  });
}

// Search Discogs for a Vinyl release and return its tracklist as
// [{ position, title, duration }]. Returns [] if nothing is found.
function fetchDiscogsTracklist(artist, album) {
  const token = PropertiesService.getScriptProperties().getProperty('DISCOGS_TOKEN');
  if (!token) throw new Error('DISCOGS_TOKEN not set in Script Properties');

  // 1) Search (type=release, format=Vinyl)
  const searchUrl = 'https://api.discogs.com/database/search'
    + '?type=release'
    + '&format=Vinyl'
    + '&artist='        + encodeURIComponent(artist)
    + '&release_title=' + encodeURIComponent(album)
    + '&per_page=5&page=1';

  const search = discogsFetch(searchUrl, token);
  if (!search || !search.results || !search.results.length) return [];

  // 2) Fetch the first matching release for its full tracklist
  const releaseId = search.results[0].id;
  if (!releaseId) return [];

  const release = discogsFetch('https://api.discogs.com/releases/' + releaseId, token);
  if (!release || !release.tracklist) return [];

  // 3) Map to position + title (+ duration); skip heading/index rows
  return release.tracklist
    .filter(t => !t.type_ || t.type_ === 'track')
    .map(t => ({
      position: String(t.position || ''),
      title:    String(t.title || ''),
      duration: String(t.duration || '')
    }))
    .filter(t => t.title);
}

// Low-level Discogs GET with required User-Agent + token.
// Returns parsed JSON, or null on any error / non-200 response.
function discogsFetch(url, token) {
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'User-Agent':    'FaasVinylCollection/1.0 +https://github.com/micahfaas/Faas-Vinyl-Collection',
      'Authorization': 'Discogs token=' + token
    }
  });
  if (res.getResponseCode() !== 200) return null;
  try {
    return JSON.parse(res.getContentText());
  } catch (err) {
    return null;
  }
}

// ── HELPERS ─────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1';
}

// Normalize a date string to ISO YYYY-MM-DD. Accepts Date objects, ISO strings,
// or anything Date() can parse. Returns empty string on failure.
function normalizeDate(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
