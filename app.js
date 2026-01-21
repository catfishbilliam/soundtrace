console.log("app.js loaded");

Chart.defaults.color = "#ffffff";
Chart.defaults.font.family =
  "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";

const CANDIDATE_COLUMNS = {
  ts: ["ts", "endTime", "played_at", "timestamp", "time"],
  ms_played: ["ms_played", "msPlayed", "ms played", "Milliseconds Played", "milliseconds_played"],

  track: [
    "master_metadata_track_name",
    "trackName",
    "track",
    "Track Name",
  ],
  artist: [
    "master_metadata_album_artist_name",
    "artistName",
    "artist",
    "Artist Name",
  ],
  album: ["master_metadata_album_album_name", "albumName", "album", "Album Name"],

  episode_name: [
    "episode_name",
    "episodeName",
    "master_metadata_episode_name",
    "episode",
    "Episode Name",
  ],
  show_name: [
    "episode_show_name",
    "show_name",
    "showName",
    "master_metadata_episode_show_name",
    "Show Name",
  ],
  spotify_episode_uri: ["spotify_episode_uri", "episode_uri", "episodeUri", "spotify_episode", "spotifyEpisodeUri"],
};

function $(id) { return document.getElementById(id); }

function pickEl(...ids) {
  for (const id of ids) {
    const el = $(id);
    if (el) return el;
  }
  return null;
}

const fileInput = pickEl("fileInput");
const runBtn = pickEl("runBtn");
const statusEl = pickEl("status");

const statsEl = pickEl("stats");
const chartsEl = pickEl("charts");
const exportEl = pickEl("export");

const dateRangeEl = pickEl("dateRange");

const totalMinutesEl = pickEl("totalMinutes");
const totalPlaysEl = pickEl("totalPlays");

const uniqueArtistsEl = pickEl("uniqueArtists", "uniqueCreators");
const uniqueTracksEl = pickEl("uniqueTracks", "uniqueItems");

const topArtistsTableEl = pickEl("topArtistsTable", "topCreatorsTable");
const topTracksTableEl = pickEl("topTracksTable", "topItemsTable");

const dataExplorerEl = pickEl("dataExplorer", "dataExplorerTable");
const deSearchEl = pickEl("deSearch", "dataExplorerSearch");
const dePageSizeEl = pickEl("dePageSize", "dataExplorerPageSize");
const dePrevBtn = pickEl("dePrevBtn", "dataExplorerPrev");
const deNextBtn = pickEl("deNextBtn", "dataExplorerNext");
const deMetaEl = pickEl("deMeta", "dataExplorerMeta");
const deDownloadBtn = pickEl("deDownloadBtn", "dataExplorerDownload");

const byYearEl = pickEl("byYear");
const heatmapEl = pickEl("heatmap");

const shareTextEl = pickEl("shareText");
const downloadJsonBtn = pickEl("downloadJsonBtn");
const downloadCsvBtn = pickEl("downloadCsvBtn");

const shareCardEl = pickEl("shareCard");
const buildSharePngBtn = pickEl("buildSharePngBtn");
const shareDownloadRowEl = pickEl("shareDownloadRow");
const sharePngLinkEl = pickEl("sharePngLink");

let charts = {};
let lastMergedRows = [];
let lastSummary = null;
let deState = {
  query: "",
  sortKey: "minutes",
  sortDir: "desc",
  page: 1,
  pageSize: 50,
};

markRevealTargets();

if (runBtn) {
  runBtn.addEventListener("click", async () => {
    console.log("Generate clicked", fileInput?.files?.length);

    const files = fileInput?.files;
    if (!files || files.length === 0) {
      alert("Upload one or more CSV files first.");
      return;
    }

    try {
      setStatus("Reading and merging files...");
      const rawRows = await parseMultipleCsv(files);

      setStatus("Normalizing schema (music only)...");
      const normalized = normalizeSpotifyRows(rawRows);

      setStatus("Removing duplicates...");
      const deduped = dedupeRows(normalized);

      if (deduped.length === 0) {
        setStatus("");
        alert("No usable MUSIC rows found after parsing. (Podcasts are excluded.)");
        return;
      }

      setStatus("Computing your Wrapped...");
      const summary = computeWrapped(deduped);

      lastMergedRows = deduped;
      lastSummary = summary;

      setStatus("");
      renderAll(summary, deduped);
      renderShareCard(summary);
      downloadSharePngBtn?.classList.remove("hidden");
      downloadSharePngBtn?.addEventListener("click", () => downloadSharePng());
      renderDataExplorer(deduped);
      runRevealAnimations();
    } catch (err) {
      console.error(err);
      setStatus("");
      alert(String(err?.message || err));
    }

  });
}

if (downloadJsonBtn) {
  downloadJsonBtn.addEventListener("click", () => {
    if (!lastSummary) return;
    const blob = new Blob([JSON.stringify(lastSummary.export_obj, null, 2)], { type: "application/json" });
    downloadBlob(blob, "spotify_wrapped_summary.json");
  });
}

if (downloadCsvBtn) {
  downloadCsvBtn.addEventListener("click", () => {
    if (!lastMergedRows?.length) return;
    const csv = rowsToCsv(lastMergedRows);
    const blob = new Blob([csv], { type: "text/csv" });
    downloadBlob(blob, "spotify_merged_cleaned.csv");
  });
}

function parseMultipleCsv(fileList) {
  const files = Array.from(fileList);
  return Promise.all(files.map(parseOneCsv)).then(arr => arr.flat());
}

function parseOneCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = (results.data || []).map(r => ({ ...r, __source_file: file.name }));
        resolve(data);
      },
      error: reject,
    });
  });
}

function firstPresentColumn(columns, candidates) {
  const colSet = new Set(columns);

  for (const c of candidates) {
    if (colSet.has(c)) return c;
  }

  const lowerMap = {};
  for (const c of columns) lowerMap[String(c).toLowerCase()] = c;

  for (const c of candidates) {
    const hit = lowerMap[String(c).toLowerCase()];
    if (hit) return hit;
  }

  return null;
}

function normalizeSpotifyRows(rows) {
  if (!rows || rows.length === 0) return [];

  const colSet = new Set();
  for (const r of rows) for (const k of Object.keys(r || {})) colSet.add(k);
  const columns = Array.from(colSet);

  const tsCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.ts);
  const msCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.ms_played);

  const trackCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.track);
  const artistCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.artist);
  const albumCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.album);

  const epNameCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.episode_name);
  const showNameCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.show_name);
  const episodeUriCol = firstPresentColumn(columns, CANDIDATE_COLUMNS.spotify_episode_uri);

  console.log("Detected columns:", {
    tsCol, msCol, trackCol, artistCol, albumCol,
    epNameCol, showNameCol, episodeUriCol
  });

  if (!tsCol) {
    const sampleCols = columns.slice(0, 30);
    throw new Error(
      `Could not find required timestamp column. Columns found: ${sampleCols.join(", ")}${columns.length > 30 ? "..." : ""}`
    );
  }

  const out = [];

  for (const r of rows) {
    const tsRaw = safeStr(r[tsCol]);
    const ts = parseDate(tsRaw);
    if (!ts) continue;

    let minutes = 0.0;
    if (msCol) {
      const ms = toNumber(r[msCol]);
      minutes = Number.isFinite(ms) ? (ms / 60000.0) : 0.0;
    }

    if (minutes <= 0) continue;

    if (isPodcastRow(r, { epNameCol, showNameCol, episodeUriCol, trackCol })) continue;

    const track = trackCol ? safeStr(r[trackCol]).trim() : "";
    const artist = artistCol ? safeStr(r[artistCol]).trim() : "";
    const album = albumCol ? safeStr(r[albumCol]).trim() : "";

    if (!track || !artist) continue;

    out.push({
      ts, 
      artist,
      track,
      album,
      minutes,
      source_file: r.__source_file || "",
    });
  }

  return out;
}

function isPodcastRow(r, cols) {
  if (cols.episodeUriCol) {
    const v = safeStr(r[cols.episodeUriCol]).trim();
    if (v) return true;
  }

  if (cols.epNameCol) {
    const v = safeStr(r[cols.epNameCol]).trim();
    if (v) return true;
  }
  if (cols.showNameCol) {
    const v = safeStr(r[cols.showNameCol]).trim();
    if (v) return true;
  }

  if (cols.trackCol) {
    const track = safeStr(r[cols.trackCol]).trim();
    if (!track) {
      const anyEpisodeLike = Object.keys(r || {}).some(k => {
        const lk = String(k).toLowerCase();
        return lk.includes("episode") || lk.includes("show");
      });
      if (anyEpisodeLike) return true;
    }
  }

  return false;
}

function parseDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (m) {
    const datePart = m[1];
    const timePart = `${m[2]}:${m[3] || "00"}`;
    const d2 = new Date(`${datePart}T${timePart}Z`);
    if (!Number.isNaN(d2.getTime())) return d2;
  }

  return null;
}

function safeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

function toNumber(v) {
  if (v === undefined || v === null) return NaN;
  const n = Number(String(v).trim());
  return n;
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const tsKey = floorToSecondIso(r.ts);
    const key = `${tsKey}|${r.artist}|${r.track}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function floorToSecondIso(dateObj) {
  const t = dateObj.getTime();
  const floored = Math.floor(t / 1000) * 1000;
  return new Date(floored).toISOString();
}

const EXCLUDE_FOR_CONSISTENCY = new Set();

function monthKeyUTC(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function seasonOfMonthUTC(month1to12) {
  if ([12, 1, 2].includes(month1to12)) return "Winter";
  if ([3, 4, 5].includes(month1to12)) return "Spring";
  if ([6, 7, 8].includes(month1to12)) return "Summer";
  return "Fall";
}

function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function std(arr) {
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function computeWrapped(rows) {
  const total_plays = rows.length;
  const total_minutes = rows.reduce((s, r) => s + (r.minutes || 0), 0);

  const artistSet = new Set();
  const trackSet = new Set(); // artist|||track
  let date_min = null;
  let date_max = null;

  const byArtist = new Map();
  const byArtistTrack = new Map();

  const byMonth = new Map(); // YYYY-MM
  const byDow = new Map();
  const byDaypart = new Map();
  const byDowHour = new Map(); // `${dow}|${hour}` -> minutes

  // additional totals
  const byYearTotal = new Map();
  const byMonthOfYear = new Map(); // 1..12
  const byHour = new Map(); // 0..23
  const bySeason = new Map();

  // per-year breakdown
  const byYearRows = new Map();

  // consistency
  const artistMonthMinutes = new Map(); // `${artist}|||YYYY-MM` -> minutes
  const artistTotalMinutes = new Map(); // artist -> minutes

  for (const r of rows) {
    artistSet.add(r.artist);
    trackSet.add(`${r.artist}|||${r.track}`);

    if (!date_min || r.ts < date_min) date_min = r.ts;
    if (!date_max || r.ts > date_max) date_max = r.ts;

    const minutes = (r.minutes || 0);
    const year = r.ts.getUTCFullYear();
    const month = r.ts.getUTCMonth() + 1;
    const hour = r.ts.getUTCHours();
    const dow = dayNameUTC(r.ts);
    const season = seasonOfMonthUTC(month);
    const mk = monthKeyUTC(r.ts);

    const yrArr = byYearRows.get(year) || [];
    yrArr.push(r);
    byYearRows.set(year, yrArr);

    const a = byArtist.get(r.artist) || { artist: r.artist, total_minutes: 0, plays: 0 };
    a.total_minutes += minutes;
    a.plays += 1;
    byArtist.set(r.artist, a);

    const atKey = `${r.artist}|||${r.track}`;
    const at = byArtistTrack.get(atKey) || { artist: r.artist, track: r.track, track_minutes: 0, plays: 0 };
    at.track_minutes += minutes;
    at.plays += 1;
    byArtistTrack.set(atKey, at);

    const monthKey = mk;
    const m = byMonth.get(monthKey) || { month: monthKey, total_minutes: 0, plays: 0 };
    m.total_minutes += minutes;
    m.plays += 1;
    byMonth.set(monthKey, m);

    const d = byDow.get(dow) || { dow, total_minutes: 0, plays: 0 };
    d.total_minutes += minutes;
    d.plays += 1;
    byDow.set(dow, d);

    const dp = daypartUTC(r.ts);
    const dpv = byDaypart.get(dp) || { daypart: dp, total_minutes: 0, plays: 0 };
    dpv.total_minutes += minutes;
    dpv.plays += 1;
    byDaypart.set(dp, dpv);

    const hmKey = `${dow}|${hour}`;
    byDowHour.set(hmKey, (byDowHour.get(hmKey) || 0) + minutes);

    byYearTotal.set(year, (byYearTotal.get(year) || 0) + minutes);
    byMonthOfYear.set(month, (byMonthOfYear.get(month) || 0) + minutes);
    byHour.set(hour, (byHour.get(hour) || 0) + minutes);
    bySeason.set(season, (bySeason.get(season) || 0) + minutes);

    artistTotalMinutes.set(r.artist, (artistTotalMinutes.get(r.artist) || 0) + minutes);
    const amKey = `${r.artist}|||${mk}`;
    artistMonthMinutes.set(amKey, (artistMonthMinutes.get(amKey) || 0) + minutes);
  }

  const unique_artists = artistSet.size;
  const unique_tracks = trackSet.size;

  // Top track per artist
  const perArtistTrackArr = Array.from(byArtistTrack.values()).sort((x, y) => {
    if (x.artist < y.artist) return -1;
    if (x.artist > y.artist) return 1;
    if (y.track_minutes !== x.track_minutes) return y.track_minutes - x.track_minutes;
    return y.plays - x.plays;
  });

  const topTrackPerArtist = new Map();
  for (const row of perArtistTrackArr) {
    if (!topTrackPerArtist.has(row.artist)) topTrackPerArtist.set(row.artist, row.track);
  }

  const top_artists = Array.from(byArtist.values())
    .sort((x, y) => (y.total_minutes - x.total_minutes) || (y.plays - x.plays))
    .slice(0, 10)
    .map(a => ({
      artist: a.artist,
      total_minutes: a.total_minutes,
      plays: a.plays,
      top_track: topTrackPerArtist.get(a.artist) || "",
    }));

  const top_tracks = Array.from(byArtistTrack.values())
    .map(t => ({ track: t.track, artist: t.artist, total_minutes: t.track_minutes, plays: t.plays }))
    .sort((x, y) => (y.total_minutes - x.total_minutes) || (y.plays - x.plays))
    .slice(0, 10);

  const monthly = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

  const dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const day_of_week = dow_order.map(name => byDow.get(name) || { dow: name, total_minutes: 0, plays: 0 });

  const dp_order = ["Morning", "Afternoon", "Evening", "Night"];
  const daypart = dp_order.map(name => byDaypart.get(name) || { daypart: name, total_minutes: 0, plays: 0 });

  // Year totals (span full range of years found in the uploaded files)
  const yearsPresent = Array.from(byYearTotal.keys()).map(Number).filter(Number.isFinite);
  const minYear = yearsPresent.length ? Math.min(...yearsPresent) : null;
  const maxYear = yearsPresent.length ? Math.max(...yearsPresent) : null;

  const year_totals = (minYear == null || maxYear == null)
    ? []
    : Array.from({ length: (maxYear - minYear + 1) }, (_, i) => minYear + i)
        .map(year => ({ year, total_minutes: byYearTotal.get(year) || 0 }));

  const month_of_year_totals = Array.from({ length: 12 }, (_, i) => i + 1)
    .map(m => ({ month: m, total_minutes: byMonthOfYear.get(m) || 0 }));

  const hour_totals = Array.from({ length: 24 }, (_, h) => h)
    .map(h => ({ hour: h, total_minutes: byHour.get(h) || 0 }));

  const season_order = ["Winter", "Spring", "Summer", "Fall"];
  const season_totals = season_order.map(s => ({ season: s, total_minutes: bySeason.get(s) || 0 }));

  // per-year: top + consistent vs previous year
  const years = Array.from(byYearRows.keys()).sort((a, b) => a - b);

  function topArtistsForRows(rs, n = 20) {
    const m = new Map();
    for (const r of rs) {
      const cur = m.get(r.artist) || { artist: r.artist, minutes: 0, plays: 0 };
      cur.minutes += (r.minutes || 0);
      cur.plays += 1;
      m.set(r.artist, cur);
    }
    return Array.from(m.values())
      .sort((a, b) => (b.minutes - a.minutes) || (b.plays - a.plays))
      .slice(0, n);
  }

  function topTrackPerArtistForRows(rs) {
    // returns Map(artist -> top_track)
    const byAT = new Map();
    for (const r of rs) {
      const key = `${r.artist}|||${r.track}`;
      byAT.set(key, (byAT.get(key) || 0) + (r.minutes || 0));
    }

    // Sort by artist, then by minutes desc
    const arr = Array.from(byAT.entries())
      .map(([k, minutes]) => {
        const [artist, track] = k.split("|||");
        return { artist, track, minutes };
      })
      .sort((a, b) => {
        if (a.artist < b.artist) return -1;
        if (a.artist > b.artist) return 1;
        return b.minutes - a.minutes;
      });

    const out = new Map();
    for (const row of arr) {
      if (!out.has(row.artist)) out.set(row.artist, row.track);
    }
    return out;
  }

  function consistencyScoreForArtistRows(rs, artist) {
    // "Consistency score" = coefficient of variation (std/mean) of monthly minutes.
    // Lower is more consistent.
    const monthly = new Map();
    for (const r of rs) {
      if (r.artist !== artist) continue;
      const mk = monthKeyUTC(r.ts);
      monthly.set(mk, (monthly.get(mk) || 0) + (r.minutes || 0));
    }

    const vals = Array.from(monthly.values()).filter(v => v > 0);
    if (vals.length < 2) return null;

    const m = mean(vals);
    if (!Number.isFinite(m) || m <= 0) return null;

    const s = std(vals);
    const cv = s / m;
    return Number.isFinite(cv) ? cv : null;
  }

  const by_year = [];
  let prevTopSet = null;

  for (const y of years) {
    const rs = byYearRows.get(y) || [];

    const top = topArtistsForRows(rs, 10);
    const top20 = topArtistsForRows(rs, 20);
    const top20Set = new Set(top20.map(x => x.artist));

    const consistent = prevTopSet ? top20.filter(x => prevTopSet.has(x.artist)).slice(0, 10) : [];

    const topTrackMap = topTrackPerArtistForRows(rs);

    // Small cards: top 5 artists for this year with top track + minutes + consistency score
    const top_cards = topArtistsForRows(rs, 5).map(a => {
      const score = consistencyScoreForArtistRows(rs, a.artist);
      return {
        artist: a.artist,
        minutes: a.minutes,
        plays: a.plays,
        top_track: topTrackMap.get(a.artist) || "",
        consistency_score: score,
      };
    });

    by_year.push({
      year: y,
      total_minutes: rs.reduce((s, r) => s + (r.minutes || 0), 0),
      total_plays: rs.length,
      top_artists: top,
      consistent_artists: consistent,
      top_cards,
    });

    prevTopSet = top20Set;
  }

  // Consistent artists (monthly presence)
  const artistMonths = new Map(); // artist -> Set(monthKey)
  for (const [k, v] of artistMonthMinutes.entries()) {
    const [artist, mk] = k.split("|||");
    if (EXCLUDE_FOR_CONSISTENCY.has(artist)) continue;
    if (v <= 0) continue;
    const s = artistMonths.get(artist) || new Set();
    s.add(mk);
    artistMonths.set(artist, s);
  }

  const consistent_artists = Array.from(artistMonths.entries())
    .map(([artist, set]) => ({
      artist,
      months_listened: set.size,
      total_minutes: artistTotalMinutes.get(artist) || 0
    }))
    .sort((a, b) => (b.months_listened - a.months_listened) || (b.total_minutes - a.total_minutes))
    .slice(0, 10);

  // Monthly intensity matrix (top artists by total minutes, excluding The Weeknd)
  const topForHeatmap = Array.from(artistTotalMinutes.entries())
    .filter(([artist]) => !EXCLUDE_FOR_CONSISTENCY.has(artist))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([artist]) => artist);

  const allMonths = Array.from(new Set(rows.map(r => monthKeyUTC(r.ts)))).sort();

  let maxCell = 0;
  const values = [];
  for (let y = 0; y < topForHeatmap.length; y++) {
    for (let x = 0; x < allMonths.length; x++) {
      const artist = topForHeatmap[y];
      const mk = allMonths[x];
      const v = artistMonthMinutes.get(`${artist}|||${mk}`) || 0;
      if (v > maxCell) maxCell = v;
      values.push({ x, y, v });
    }
  }

  const monthly_intensity = {
    artists: topForHeatmap,
    months: allMonths,
    values,
    max: maxCell,
  };

  // Bubble: consistency vs dominance
  const consistency_bubbles = [];
  const artistConsistencyMap = new Map(); // artist -> cv
  for (const [artist, set] of artistMonths.entries()) {
    if (EXCLUDE_FOR_CONSISTENCY.has(artist)) continue;

    const monthlyTotals = Array.from(set)
      .map(mk => artistMonthMinutes.get(`${artist}|||${mk}`) || 0)
      .filter(v => v > 0);

    if (monthlyTotals.length < 2) continue;

    const m = mean(monthlyTotals);
    if (m <= 0) continue;

    const s = std(monthlyTotals);
    const cv = s / m;

    consistency_bubbles.push({
      artist,
      months_listened: monthlyTotals.length,
      cv,
      avg: m,
    });
    artistConsistencyMap.set(artist, cv);
  }

  const share_text = makeShareText({
    date_min,
    date_max,
    total_plays,
    total_minutes,
    unique_artists,
    unique_tracks,
    top_artists,
    top_tracks,
  });

  const export_obj = {
    total_minutes,
    total_plays,
    unique_artists,
    unique_tracks,
    date_min_utc: date_min ? date_min.toISOString() : null,
    date_max_utc: date_max ? date_max.toISOString() : null,
    top_artists,
    top_tracks,
    monthly,
    day_of_week,
    daypart,
    year_totals,
    month_of_year_totals,
    hour_totals,
    season_totals,
    by_year,
    consistent_artists,
    monthly_intensity,
    consistency_bubbles,
    dow_hour_heatmap: Object.fromEntries(byDowHour.entries()),
    artist_consistency: Object.fromEntries(artistConsistencyMap.entries()),
  };

  return {
    total_minutes,
    total_plays,
    unique_artists,
    unique_tracks,
    date_min,
    date_max,
    top_artists,
    top_tracks,
    monthly,
    day_of_week,
    daypart,
    year_totals,
    month_of_year_totals,
    hour_totals,
    season_totals,
    by_year,
    consistent_artists,
    monthly_intensity,
    consistency_bubbles,
    byDowHour,
    share_text,
    export_obj,
    artistConsistencyMap,
  };
}

function dayNameUTC(d) {
  const n = d.getUTCDay();
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][n];
}

function daypartUTC(d) {
  const h = d.getUTCHours();
  if (h >= 5 && h <= 11) return "Morning";
  if (h >= 12 && h <= 16) return "Afternoon";
  if (h >= 17 && h <= 21) return "Evening";
  return "Night";
}

function makeShareText(s) {
  const rng = (s.date_min && s.date_max)
    ? `${s.date_min.toISOString().slice(0, 10)} to ${s.date_max.toISOString().slice(0, 10)}`
    : "your full dataset";

  const top_artist = s.top_artists?.length ? s.top_artists[0].artist : "—";
  const top_track = s.top_tracks?.length ? `${s.top_tracks[0].track} — ${s.top_tracks[0].artist}` : "—";

  return (
    `I pulled my Spotify listening history (${rng}).\n\n` +
    `Total plays: ${formatInt(s.total_plays)}\n` +
    `Total minutes: ${formatInt(Math.round(s.total_minutes))}\n` +
    `Unique artists: ${formatInt(s.unique_artists)}\n` +
    `Unique tracks: ${formatInt(s.unique_tracks)}\n\n` +
    `Top artist: ${top_artist}\n` +
    `Top track: ${top_track}\n`
  );
}

function formatInt(n) {
  return Number(n || 0).toLocaleString();
}

/* ---------------------------
   Render
--------------------------- */

function renderAll(summary, mergedRows) {
  // show report sections
  statsEl?.classList.remove("hidden");
  chartsEl?.classList.remove("hidden");
  exportEl?.classList.remove("hidden");
  dateRangeEl?.classList.remove("hidden");

  // stats
  if (totalMinutesEl) totalMinutesEl.textContent = formatInt(Math.round(summary.total_minutes));
  if (totalPlaysEl) totalPlaysEl.textContent = formatInt(summary.total_plays);
  if (uniqueArtistsEl) uniqueArtistsEl.textContent = formatInt(summary.unique_artists);
  if (uniqueTracksEl) uniqueTracksEl.textContent = formatInt(summary.unique_tracks);

  if (dateRangeEl) {
    if (summary.date_min && summary.date_max) {
      dateRangeEl.textContent = `Date range: ${summary.date_min.toISOString().slice(0, 10)} → ${summary.date_max.toISOString().slice(0, 10)} (UTC)`;
    } else {
      dateRangeEl.textContent = "";
    }
  }

  if (shareTextEl) shareTextEl.value = summary.share_text || "";

  destroyCharts();

  // Existing canvases (works with your earlier HTML)
  charts.topArtists = renderBarHorizontal(
    pickEl("topArtistsChart", "topCreatorsChart"),
    summary.top_artists
      .slice()
      .sort((a, b) => b.total_minutes - a.total_minutes)
      .map(r => r.artist),
    summary.top_artists
      .slice()
      .sort((a, b) => b.total_minutes - a.total_minutes)
      .map(r => r.total_minutes),
    "Minutes"
  );

  charts.topTracks = renderBarHorizontal(
    pickEl("topTracksChart", "topItemsChart"),
    summary.top_tracks
      .map(t => ({ label: `${t.track} — ${t.artist}`, v: t.total_minutes }))
      .sort((a, b) => b.v - a.v)
      .map(r => r.label),
    summary.top_tracks
      .map(t => ({ label: `${t.track} — ${t.artist}`, v: t.total_minutes }))
      .sort((a, b) => b.v - a.v)
      .map(r => r.v),
    "Minutes"
  );

  charts.monthly = renderLine(
    pickEl("monthlyChart"),
    summary.monthly.map(r => r.month),
    summary.monthly.map(r => r.total_minutes),
    "Total Minutes"
  );

  charts.dow = renderBar(
    pickEl("weekdayChart", "dowChart"),
    summary.day_of_week.map(r => r.dow),
    summary.day_of_week.map(r => r.total_minutes),
    "Total Minutes"
  );

  charts.daypart = renderBar(
    pickEl("daypartChart"),
    summary.daypart.map(r => r.daypart),
    summary.daypart.map(r => r.total_minutes),
    "Total Minutes"
  );

  // New canvases (only render if you add these IDs to index.html)
  charts.yearTotal = renderLine(
    pickEl("yearTotalChart"),
    summary.year_totals.map(r => String(r.year)),
    summary.year_totals.map(r => r.total_minutes),
    "Total Minutes"
  );

  charts.monthOfYear = renderLine(
    pickEl("monthOfYearChart"),
    summary.month_of_year_totals.map(r => String(r.month)),
    summary.month_of_year_totals.map(r => r.total_minutes),
    "Total Minutes"
  );

  charts.hour = renderLine(
    pickEl("hourChart"),
    summary.hour_totals.map(r => String(r.hour)),
    summary.hour_totals.map(r => r.total_minutes),
    "Total Minutes"
  );

  charts.season = renderBar(
    pickEl("seasonChart"),
    summary.season_totals.map(r => r.season),
    summary.season_totals.map(r => r.total_minutes),
    "Total Minutes"
  );

  charts.consistent = renderBarHorizontal(
    pickEl("consistentArtistsChart"),
    summary.consistent_artists
      .slice()
      .sort((a, b) => b.months_listened - a.months_listened)
      .map(r => r.artist),
    summary.consistent_artists
      .slice()
      .sort((a, b) => b.months_listened - a.months_listened)
      .map(r => r.months_listened),
    "Months Listened"
  );

  charts.matrix = renderMonthlyIntensityMatrix(pickEl("monthlyIntensityMatrixChart"), summary.monthly_intensity);
  charts.bubbles = renderConsistencyBubble(pickEl("consistencyBubbleChart"), summary.consistency_bubbles);

  // tables
  if (topArtistsTableEl) {
    const cMap = summary.artistConsistencyMap;
    topArtistsTableEl.innerHTML = renderTable(summary.top_artists.map(r => ({
      artist: r.artist,
      minutes: round1(r.total_minutes),
      plays: r.plays,
      top_track: r.top_track,
      consistency_score: (cMap && cMap.get && cMap.get(r.artist) != null)
        ? Number(cMap.get(r.artist)).toFixed(2)
        : ""
    })));
  }

  if (topTracksTableEl) {
    topTracksTableEl.innerHTML = renderTable(summary.top_tracks.map(r => ({
      track: r.track,
      artist: r.artist,
      minutes: round1(r.total_minutes),
      plays: r.plays
    })))
  }

  // by year
  if (byYearEl) {
    byYearEl.innerHTML =
      renderTopYears(summary.year_totals || []) +
      renderByYear(summary.by_year || []);
  }

  // heatmap
  if (heatmapEl) heatmapEl.innerHTML = renderHeatmap(summary.byDowHour);
}

function destroyCharts() {
  for (const k of Object.keys(charts)) {
    try { charts[k]?.destroy(); } catch { }
  }
  charts = {};
}

/* ---------------------------
   Chart rendering
--------------------------- */

function renderLine(canvasEl, labels, values, yLabel) {
  if (!canvasEl) return null;
  return new Chart(canvasEl, {
    type: "line",
    data: { labels, datasets: [{ label: yLabel, data: values, tension: 0.25 }] },
    options: chartOptsLine(yLabel)
  });
}

function renderBar(canvasEl, labels, values, yLabel) {
  if (!canvasEl) return null;
  return new Chart(canvasEl, {
    type: "bar",
    data: { labels, datasets: [{ label: yLabel, data: values }] },
    options: chartOptsBar(yLabel)
  });
}

function renderBarHorizontal(canvasEl, labels, values, xLabel) {
  if (!canvasEl) return null;
  return new Chart(canvasEl, {
    type: "bar",
    data: { labels, datasets: [{ label: xLabel, data: values }] },
    options: chartOptsHorizontal(xLabel)
  });
}

function renderMonthlyIntensityMatrix(canvasEl, mi) {
  if (!canvasEl) return null;
  if (!mi || !mi.values || !mi.months?.length || !mi.artists?.length) return null;

  // Requires chartjs-chart-matrix plugin. If it's not loaded, skip gracefully.
  if (!Chart?.registry?.getController("matrix")) {
    console.warn("chartjs-chart-matrix not found. Skipping matrix heatmap.");
    return null;
  }

  const max = mi.max || 1;

  return new Chart(canvasEl, {
    type: "matrix",
    data: {
      datasets: [{
        label: "Minutes",
        data: mi.values.map(p => ({ x: p.x, y: p.y, v: p.v })),
        backgroundColor: (ctx) => {
          const v = ctx.raw?.v || 0;
          const a = Math.max(0.06, Math.min(0.95, v / max));
          return `rgba(29, 185, 84, ${a})`;
        },
        borderWidth: 0,
        width: (ctx) => {
          const area = ctx.chart.chartArea;
          if (!area) return 10;
          return Math.max(4, (area.width / mi.months.length) - 1);
        },
        height: (ctx) => {
          const area = ctx.chart.chartArea;
          if (!area) return 12;
          return Math.max(10, (area.height / mi.artists.length) - 1);
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const it = items[0].raw;
              return `${mi.artists[it.y]} — ${mi.months[it.x]}`;
            },
            label: (item) => `Minutes: ${Math.round(item.raw.v)}`
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          ticks: { callback: (val) => mi.months[val] ?? "" },
          grid: { display: false }
        },
        y: {
          type: "linear",
          ticks: { callback: (val) => mi.artists[val] ?? "" },
          grid: { display: false }
        }
      }
    }
  });
}

function renderConsistencyBubble(canvasEl, points) {
  if (!canvasEl) return null;
  if (!points || !points.length) return null;

  const data = points.map(p => ({
    x: p.months_listened,
    y: p.cv,
    r: Math.max(3, Math.min(18, Math.sqrt(p.avg) / 2)),
    artist: p.artist,
    avg: p.avg
  }));

  return new Chart(canvasEl, {
    type: "bubble",
    data: { datasets: [{ label: "Artists", data }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].raw.artist,
            label: (item) => `Months: ${item.raw.x} • Consistency score: ${item.raw.y.toFixed(2)} • Avg monthly min: ${Math.round(item.raw.avg)}`
          }
        }
      },
      scales: {
        x: { title: { display: true, text: "Months Listened" } },
        y: { title: { display: true, text: "Consistency score (CV) — lower = more consistent" } }
      }
    }
  });
}

/* ---------------------------
   Chart options
--------------------------- */

function chartOptsHorizontal(xLabel) {
  return {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: xLabel } },
      y: { ticks: { autoSkip: false } }
    }
  };
}

function chartOptsBar(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { title: { display: true, text: yLabel } } }
  };
}

function chartOptsLine(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { title: { display: true, text: yLabel } } }
  };
}

/* ---------------------------
   Tables + downloads
--------------------------- */

function renderTable(rows) {
  if (!rows || !rows.length) return `<div class="hint">No data.</div>`;
  const cols = Object.keys(rows[0]);

  const thead = `<thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r =>
    `<tr>${cols.map(c => `<td>${escapeHtml(String(r[c] ?? ""))}</td>`).join("")}</tr>`
  ).join("")}</tbody>`;

  return `<table>${thead}${tbody}</table>`;
}

function rowsToCsv(rows) {
  const header = ["ts", "artist", "track", "album", "minutes", "source_file"];
  const lines = [header.join(",")];

  for (const r of rows) {
    const vals = [
      r.ts.toISOString(),
      r.artist || "",
      r.track || "",
      r.album || "",
      (Number.isFinite(r.minutes) ? r.minutes : 0),
      r.source_file || ""
    ].map(csvEscape);
    lines.push(vals.join(","));
  }

  return lines.join("\n");
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function round1(x) { return Math.round((x || 0) * 10) / 10; }
function round3(x) { return Math.round((x || 0) * 1000) / 1000; }

/* ---------------------------
   UI helpers
--------------------------- */

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function renderByYear(by_year) {
  if (!by_year.length) return `<div class="hint">No year breakdown available.</div>`;

  function renderTopCardsBlock(y) {
    const cards = (y.top_cards || []);
    if (!cards.length) return "";

    const cardHtml = cards.map(c => {
      const score = (c.consistency_score == null) ? "" : Number(c.consistency_score).toFixed(2);
      return `
        <div class="miniCard">
          <div class="miniTitle">${escapeHtml(c.artist)}</div>
          <div class="miniSub">Top song: ${escapeHtml(c.top_track || "")}</div>
          <div class="miniMeta">${formatInt(Math.round(c.minutes || 0))} min • ${formatInt(c.plays || 0)} plays</div>
          <div class="miniMeta">Consistency score: ${escapeHtml(score)}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="miniGridWrap">
        <div class="hint" style="margin:0 0 8px;">Top 5 artists</div>
        <div class="miniGrid">${cardHtml}</div>
      </div>
    `;
  }

  const blocks = by_year.map(y => {
    const topTbl = renderTable((y.top_artists || []).map(r => ({
      artist: r.artist,
      minutes: round1(r.minutes),
      plays: r.plays
    })));

    const consTbl = renderTable((y.consistent_artists || []).map(r => ({
      artist: r.artist,
      minutes: round1(r.minutes),
      plays: r.plays
    })));

    return `
      <div class="card" style="margin:0 0 12px;">
        <h3 style="margin:0 0 8px; font-size:14px;">${escapeHtml(String(y.year))}</h3>
        <div class="hint" style="margin:0 0 10px;">Minutes: ${formatInt(Math.round(y.total_minutes || 0))} • Plays: ${formatInt(y.total_plays || 0)}</div>
        ${renderTopCardsBlock(y)}
        <div class="grid" style="gap:12px;">
          <div class="span-6">
            <div class="hint" style="margin:0 0 6px;">Top</div>
            ${topTbl}
          </div>
          <div class="span-6">
            <div class="hint" style="margin:0 0 6px;">Consistent vs previous year</div>
            ${consTbl}
          </div>
        </div>
      </div>
    `;
  });

  return blocks.join("");
}

/* ---------------------------
   GSAP reveal helpers
--------------------------- */

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function markRevealTargets() {
  // Add .reveal to the sections we animate once data exists
  [statsEl, chartsEl, exportEl, pickEl("dataExplorerWrap")].forEach(el => {
    if (el) el.classList.add("reveal");
  });

  // Also reveal each card inside charts for a stagger effect
  if (chartsEl) {
    chartsEl.querySelectorAll(".card").forEach(card => card.classList.add("reveal"));
  }
}

function runRevealAnimations() {
  if (prefersReducedMotion()) {
    document.querySelectorAll(".reveal").forEach(el => {
      el.style.opacity = 1;
      el.style.transform = "none";
    });
    return;
  }

  if (!window.gsap) {
    console.warn("GSAP not found; skipping animations.");
    document.querySelectorAll(".reveal").forEach(el => {
      el.style.opacity = 1;
      el.style.transform = "none";
    });
    return;
  }

  // Clear any previous inline styles from earlier runs
  gsap.set(".reveal", { clearProps: "opacity,transform" });

  // Main sections
  gsap.fromTo(
    [statsEl, chartsEl, pickEl("dataExplorerWrap"), exportEl].filter(Boolean),
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.08 }
  );

  // Cards inside charts
  if (chartsEl) {
    gsap.fromTo(
      chartsEl.querySelectorAll(".card.reveal"),
      { opacity: 0, y: 14, scale: 0.99 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out", stagger: 0.06, delay: 0.05 }
    );
  }
}

function renderTopYears(year_totals) {
  if (!year_totals || !year_totals.length) return "";

  const top = year_totals
    .slice()
    .sort((a, b) => b.total_minutes - a.total_minutes)
    .slice(0, 10)
    .map(r => ({
      year: r.year,
      minutes: round1(r.total_minutes)
    }));

  return `
    <div class="card" style="margin:0 0 12px;">
      <h3 style="margin:0 0 8px; font-size:14px;">Top years</h3>
      ${renderTable(top)}
    </div>
  `;
}

function renderHeatmap(byDowHour) {
  const dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  let max = 0;
  for (const d of dow_order) {
    for (const h of hours) {
      const v = byDowHour?.get?.(`${d}|${h}`) || 0;
      if (v > max) max = v;
    }
  }

  const head = [
    `<div class="hm-head hm-rowlabel">UTC</div>`,
    ...hours.map(h => `<div class="hm-head">${h}</div>`)
  ].join("");

  const rows = dow_order.map(d => {
    const cells = hours.map(h => {
      const v = byDowHour?.get?.(`${d}|${h}`) || 0;
      const a = max > 0 ? (0.08 + 0.72 * (v / max)) : 0.08;
      const title = `${d} @ ${h}:00 — ${Math.round(v)} min`;
      return `<div class="hm-cell hm-val" style="--a:${a.toFixed(3)}" title="${escapeHtml(title)}">${v ? Math.round(v) : ""}</div>`;
    }).join("");

    return `<div class="hm-cell hm-rowlabel">${escapeHtml(d)}</div>${cells}`;
  }).join("");

  return `<div class="heatmap">${head}${rows}</div>`;
}

/* ---------------------------
   Data Explorer (AGGREGATED TRACKS: search + sort + pagination)
--------------------------- */

function renderDataExplorer(rows) {
  if (!dataExplorerEl) return;

  // Wire events once
  if (!renderDataExplorer._wired) {
    renderDataExplorer._wired = true;

    if (deSearchEl) {
      deSearchEl.addEventListener("input", () => {
        deState.query = (deSearchEl.value || "").trim().toLowerCase();
        deState.page = 1;
        updateDataExplorer();
      });
    }

    if (dePageSizeEl) {
      dePageSizeEl.addEventListener("change", () => {
        deState.pageSize = Number(dePageSizeEl.value || 50);
        deState.page = 1;
        updateDataExplorer();
      });
    }

    dePrevBtn?.addEventListener("click", () => {
      deState.page = Math.max(1, deState.page - 1);
      updateDataExplorer();
    });

    deNextBtn?.addEventListener("click", () => {
      deState.page = deState.page + 1;
      updateDataExplorer();
    });

    deDownloadBtn?.addEventListener("click", () => {
      const filtered = getFilteredSortedRows(deState._aggTracks || buildAggregatedTracks(lastMergedRows || []));
      const csv = aggregatedRowsToCsv(filtered);
      const blob = new Blob([csv], { type: "text/csv" });
      downloadBlob(blob, "spotify_tracks_aggregated.csv");
    });

    // Sort by clicking table headers (event delegation)
    dataExplorerEl.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;

      const nextKey = th.getAttribute("data-sort");
      if (!nextKey) return;

      if (deState.sortKey === nextKey) {
        deState.sortDir = (deState.sortDir === "asc") ? "desc" : "asc";
      } else {
        deState.sortKey = nextKey;
        // Text fields default asc, numeric/date totals default desc
        deState.sortDir = (nextKey === "artist" || nextKey === "track" || nextKey === "album") ? "asc" : "desc";
      }

      deState.page = 1;
      updateDataExplorer();
    });
  }

  // Store raw plays, then build aggregated dataset for explorer
  lastMergedRows = rows || [];
  deState._aggTracks = buildAggregatedTracks(lastMergedRows);

  // Initialize inputs
  if (deSearchEl) deSearchEl.value = deState.query || "";
  if (dePageSizeEl) dePageSizeEl.value = String(deState.pageSize || 50);

  updateDataExplorer();
}

function updateDataExplorer() {
  const agg = deState._aggTracks || buildAggregatedTracks(lastMergedRows || []);
  const filteredSorted = getFilteredSortedRows(agg);

  const total = filteredSorted.length;
  const pageSize = deState.pageSize || 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  deState.page = Math.min(deState.page, totalPages);

  const start = (deState.page - 1) * pageSize;
  const pageRows = filteredSorted.slice(start, start + pageSize);

  dataExplorerEl.innerHTML = renderExplorerTable(pageRows);
  applySortIndicators();

  if (deMetaEl) {
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(total, start + pageSize);
    deMetaEl.textContent = `Showing ${from}-${to} of ${formatInt(total)} • Page ${deState.page}/${totalPages}`;
  }
  if (dePrevBtn) dePrevBtn.disabled = deState.page <= 1;
  if (deNextBtn) deNextBtn.disabled = deState.page >= totalPages;

  applySortIndicators();
}

function getFilteredSortedRows(rows) {
  const q = (deState.query || "").trim();
  let out = rows;

  if (q) {
    out = rows.filter(r => {
      const hay = [
        r.artist,
        r.track,
        r.album,
        r.first_ts || "",
        r.last_ts || ""
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  const key = deState.sortKey || "minutes";
  const dir = deState.sortDir || "desc";
  const mul = dir === "asc" ? 1 : -1;

  return out.slice().sort((a, b) => {
    const av = getSortVal(a, key);
    const bv = getSortVal(b, key);
    if (av < bv) return -1 * mul;
    if (av > bv) return  1 * mul;
    return 0;
  });
}

function getSortVal(r, key) {
  switch (key) {
    case "minutes": return Number.isFinite(r.minutes) ? r.minutes : 0;
    case "plays": return Number.isFinite(r.plays) ? r.plays : 0;
    case "artist": return (r.artist || "").toLowerCase();
    case "track": return (r.track || "").toLowerCase();
    case "album": return (r.album || "").toLowerCase();
    case "first_ts": return r.first_ts ? Date.parse(r.first_ts) : 0;
    case "last_ts": return r.last_ts ? Date.parse(r.last_ts) : 0;
    default: return (r[key] ?? "");
  }
}

function renderExplorerTable(rows) {
  const cols = [
    { key: "artist", label: "artist" },
    { key: "track", label: "track" },
    { key: "album", label: "album" },
    { key: "minutes", label: "minutes" },
    { key: "plays", label: "plays" },
    { key: "first_ts", label: "first_play" },
    { key: "last_ts", label: "last_play" },
  ];

  const thead = `<thead><tr>${
    cols.map(c => {
      const cls = (c.key === deState.sortKey)
        ? (deState.sortDir === "asc" ? "sort-asc" : "sort-desc")
        : "";
      return `<th data-sort="${escapeHtml(c.key)}" class="${cls}">${escapeHtml(c.label)}</th>`;
    }).join("")
  }</tr></thead>`;

  const tbody = `<tbody>${
    (rows || []).map(r => `
      <tr>
        <td>${escapeHtml(r.artist || "")}</td>
        <td>${escapeHtml(r.track || "")}</td>
        <td>${escapeHtml(r.album || "")}</td>
        <td>${escapeHtml(String(round3(r.minutes)))}</td>
        <td>${escapeHtml(String(r.plays ?? 0))}</td>
        <td>${escapeHtml(r.first_ts || "")}</td>
        <td>${escapeHtml(r.last_ts || "")}</td>
      </tr>
    `).join("")
  }</tbody>`;

  if (!rows || rows.length === 0) {
    return `<table>${thead}<tbody><tr><td colspan="${cols.length}" class="hint" style="padding:12px;">No rows match your filter.</td></tr></tbody></table>`;
  }

  return `<table>${thead}${tbody}</table>`;
}

function applySortIndicators() {
  if (!dataExplorerEl) return;
  const ths = dataExplorerEl.querySelectorAll("th[data-sort]");
  ths.forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    const k = th.getAttribute("data-sort");
    if (k === deState.sortKey) {
      th.classList.add(deState.sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function buildAggregatedTracks(rows) {
  // One row per (artist, track, album)
  const m = new Map();

  for (const r of rows || []) {
    const artist = r.artist || "";
    const track = r.track || "";
    const album = r.album || "";
    if (!artist || !track) continue;

    const key = `${artist}|||${track}|||${album}`;
    const cur = m.get(key) || {
      artist,
      track,
      album,
      minutes: 0,
      plays: 0,
      first_ts: null,
      last_ts: null,
    };

    const minutes = Number.isFinite(r.minutes) ? r.minutes : 0;
    cur.minutes += minutes;
    cur.plays += 1;

    const iso = r.ts ? r.ts.toISOString() : null;
    if (iso) {
      if (!cur.first_ts || iso < cur.first_ts) cur.first_ts = iso;
      if (!cur.last_ts || iso > cur.last_ts) cur.last_ts = iso;
    }

    m.set(key, cur);
  }

  return Array.from(m.values());
}

function aggregatedRowsToCsv(rows) {
  const header = ["artist", "track", "album", "minutes", "plays", "first_play_utc", "last_play_utc"];
  const lines = [header.join(",")];

  for (const r of rows || []) {
    const vals = [
      r.artist || "",
      r.track || "",
      r.album || "",
      (Number.isFinite(r.minutes) ? r.minutes : 0),
      (Number.isFinite(r.plays) ? r.plays : 0),
      r.first_ts || "",
      r.last_ts || "",
    ].map(csvEscape);
    lines.push(vals.join(","));
  }

  return lines.join("\n");
}

function renderShareCard(summary) {
  if (!shareCardEl) return;

  shareCardEl.classList.remove("hidden");

  if (shareRangeEl && summary.date_min && summary.date_max) {
    shareRangeEl.textContent =
      `${summary.date_min.toISOString().slice(0,10)} → ${summary.date_max.toISOString().slice(0,10)} (UTC)`;
  }

  if (shareStatsEl) {
    shareStatsEl.innerHTML = [
      statChip("Total minutes", formatInt(Math.round(summary.total_minutes))),
      statChip("Total plays", formatInt(summary.total_plays)),
      statChip("Artists", formatInt(summary.unique_artists)),
      statChip("Tracks", formatInt(summary.unique_tracks))
    ].join("");
  }

  if (shareTopArtistsTableEl) {
    shareTopArtistsTableEl.innerHTML = renderTable(
      (summary.top_artists || []).slice(0, 10).map(a => ({
        artist: a.artist,
        minutes: round1(a.total_minutes),
        plays: a.plays,
        top_track: a.top_track
      }))
    );
  }

  if (shareTopTracksTableEl) {
    shareTopTracksTableEl.innerHTML = renderTable(
      (summary.top_tracks || []).slice(0, 10).map(t => ({
        track: t.track,
        artist: t.artist,
        minutes: round1(t.total_minutes),
        plays: t.plays
      }))
    );
  }

  try { charts.shareYear?.destroy(); } catch {}
  try { charts.shareWeekday?.destroy(); } catch {}

  charts.shareYear = renderLine(
    pickEl("shareYearChart"),
    summary.year_totals.map(r => String(r.year)),
    summary.year_totals.map(r => r.total_minutes),
    "Minutes"
  );

  charts.shareWeekday = renderBar(
    pickEl("shareWeekdayChart"),
    summary.day_of_week.map(r => r.dow),
    summary.day_of_week.map(r => r.total_minutes),
    "Minutes"
  );
}

function statChip(label, value) {
  return `<div class="shareStat"><div class="shareStatVal">${escapeHtml(value)}</div><div class="shareStatLab">${escapeHtml(label)}</div></div>`;
}

async function downloadSharePng() {
  if (!shareCardEl || !window.html2canvas) {
    alert("html2canvas not loaded.");
    return;
  }

  const wasHidden = shareCardEl.classList.contains("hidden");
  shareCardEl.classList.remove("hidden");

  const canvas = await html2canvas(shareCardEl, {
    backgroundColor: "#0b0b0b",
    scale: 2,
    useCORS: true
  });

  const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
  if (!blob) return;

  downloadBlob(blob, "soundtrace_share.png");

  if (wasHidden) shareCardEl.classList.add("hidden");
}