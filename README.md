# Elden Ring — Ultimate Region Tracker

Upload your save and see, **region by region**, what you've completed and what's left — **items**
(with where-to-find hints), **bosses** (defeated / not, with a location line), and **Sites of
Grace** — plus a global section for cookbooks, bell bearings, whetblades, tools, gestures, crystal
tears and quantifiable collectibles.

## Running it

### Easiest (Windows)

**Double-click `start.bat`.** It launches a small local web server and opens the tracker in your
default browser automatically. Keep the little black window open while you use it, and close it when
you're done. (Requires [Python](https://www.python.org/downloads/) — during install, tick
*"Add Python to PATH"*.)

### Manual (any OS)

It's a static site, so you can also serve this folder yourself:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>.

Everything runs in your browser — the save file is never uploaded anywhere. Find your save at
`%AppData%\EldenRing\<id>\ER0000.sl2`.

## Updating as you play (Refresh)

In **Chrome or Edge**, once you've picked your save a **↻ Refresh from disk** button appears in the
controls bar. After the game writes a new save (rest at a grace, quit to menu, etc.), click it and
the view updates in place — no need to re-open the file. Your expanded regions and filters stay put.
The chosen file is also remembered, so on your next visit a **↻ Reload last save** button lets you
jump back in with one click (the browser asks once for read permission).

Firefox and Safari don't support this API yet, so there you'll re-pick the file to update.

## Layout

```
start.bat             – double-click launcher (starts the server + opens the browser)
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
