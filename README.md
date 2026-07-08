# Elden Ring — Ultimate Region Tracker

Upload your save and see, **region by region**, what you've completed and what's left — **items**
(with where-to-find hints), **bosses** (defeated / not, with a location line), and **Sites of
Grace** — plus a global section for cookbooks, bell bearings, whetblades, tools, gestures, crystal
tears and quantifiable collectibles.

## Running it

### Easiest (Windows)

**Double-click `start.bat`.** It starts a small local helper and opens the tracker in your default
browser. The helper **auto-detects your Elden Ring save** — just pick your character and click
**Analyze**. Keep the little black window open while you use it, and close it when you're done.
(Requires [Python](https://www.python.org/downloads/) — during install, tick *"Add Python to PATH"*.)

### Manual (any OS)

```bash
python server.py
```

Then open <http://localhost:8000/>. `server.py` serves the app and exposes your save locally so the
app can auto-load and refresh it. (You can also just serve the folder statically with
`python -m http.server 8000`, but then there's no auto-detect — you'll pick the file yourself.)

Everything runs on your machine — the save is never uploaded anywhere; the helper binds to
`localhost` only. Saves live at `%AppData%\EldenRing\<id>\ER0000.sl2`.

## Updating as you play (Refresh)

Once analyzed, a **↻ Refresh from disk** button sits in the controls bar. After the game writes a new
save (rest at a grace, quit to menu, beat a boss), click it and the view updates in place — your
expanded regions and filters stay exactly as they were. With `start.bat` / `server.py` this works in
**every browser, including Firefox and Zen**, because the local helper re-reads the file for you.

If you instead open the app as a plain static page in **Chrome or Edge** (no helper), it falls back to
the browser's File System Access API: you pick the file once, then the same Refresh button — plus a
**↻ Reload last save** shortcut on return — works from there.

## Layout

```
start.bat             – double-click launcher (Windows): runs server.py
server.py             – local helper: serves the app + auto-detects/serves your save
index.html            – the app
assets/app.js         – save parsing + model + rendering (vanilla JS, no dependencies)
assets/style.css      – styling
assets/json/          – game data (items, bosses, graces, cookbooks, event-flag map, …)
assets/img/           – item art (items/) and hint icons (hints/)
data/boss_meta.json   – boss -> { region, zone, location }
data/region_map.json  – canonical region order + grace-subcategory -> region map
data/generate_boss_meta.py – regenerates the two data/ files from assets/json
```

## How it works

- **Save parsing** (`assets/app.js`) reads both inventory item IDs and event flags in a single
  pass. Items come from `assets/json/data.json` + `dlcData.json` (already Region → Zone → item with
  location hints). Bosses / graces / cookbooks / etc. are detected via save **event flags**
  (`assets/json/*.json` + `eventflag_bst.json`), and their regions come from `data/`.

## The boss data

`data/boss_meta.json` gives each of the 208 boss event-flags a `{ region, zone, location }`. It's
**best-effort**: most entries were derived automatically (from the region named in the boss name,
from matching grace sites, and from the hints already in `data.json`), with ~50 hand-corrected. If
you spot a boss in the wrong region or want a better "where", just edit that file — it's plain JSON
and the app re-reads it on load. `data/generate_boss_meta.py` (Python 3, run from this folder)
rebuilds it; edit its `OVERRIDE` table for durable corrections.
