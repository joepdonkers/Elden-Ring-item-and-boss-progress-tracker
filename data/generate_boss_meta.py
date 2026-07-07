import json, re, os
ROOT = r"C:\Users\joepi\Downloads\elden-ring-progress-main"
# all source json now lives in the single app's assets/json folder
CK = os.path.join(ROOT, "assets", "json")

def load(p):
    for enc in ('utf-16','utf-8-sig','utf-8'):
        try:
            with open(p, encoding=enc) as f: return json.load(f)
        except Exception: pass
    raise Exception('fail '+p)

data   = load(os.path.join(ROOT,'assets','json','data.json'))
dlcData= load(os.path.join(ROOT,'assets','json','dlcData.json'))
bosses = load(os.path.join(CK,'bosses.json'))['bosses']
graces = load(os.path.join(CK,'graces.json'))['graces']
dlc    = load(os.path.join(CK,'dlc_items.json'))
dlc_bosses = dlc.get('bosses',{})
dlc_graces = dlc.get('graces',{})

BASE_REGIONS = list(data.keys())          # 13
DLC_REGIONS  = [r for r in dlcData.keys()] # 8

# grace subcategory -> canonical region
SUBCAT2REGION = {
  # base
  'Stormhill':'Limgrave','Stormveil Castle':'Limgrave','Stranded Graveyard':'Limgrave','Limgrave':'Limgrave',
  'Weeping Peninsula':'Weeping Peninsula',
  'Liurnia of the Lakes':'Liurnia of the Lakes','Academy of Raya Lucaria':'Liurnia of the Lakes',
  'Bellum Highway':'Liurnia of the Lakes','Moonlight Altar':'Liurnia of the Lakes','Ruin-Strewn Precipice':'Liurnia of the Lakes',
  'Caelid':'Caelid','Swamp of Aeonia':'Caelid',
  "Greyoll's Dragonbarrow":'Dragonbarrow',
  'Altus Plateau':'Altus Plateau','Capital Outskirts':'Altus Plateau',
  'Leyndell, Royal Capital':'Altus Plateau','Leyndell, Ashen Capital':'Altus Plateau',
  'Mt. Gelmir':'Mt Gelmir','Volcano Manor':'Mt Gelmir',
  'Mountaintops of the Giants':'Mountaintops of the Giants','Flame Peak':'Mountaintops of the Giants','Forbiden Lands':'Mountaintops of the Giants',
  'Consecrated Snowfield':'Consecrated Snowfield',"Miquella's Haligtree":'Consecrated Snowfield','Elphael, Brace of the Haligtree':'Consecrated Snowfield',
  'Crumbling Farum Azula':'Crumbling Farum Azula',
  'Ainsel River':'Underground','Ainsel River Main':'Underground','Deeproot Depths':'Underground','Lake of Rot':'Underground',
  'Mohgwyn Palace':'Underground','Nokron, Eternal City':'Underground','Siofra River':'Underground','Subterranean Shunning-Grounds':'Underground',
  'Stone Platform':'Crumbling Farum Azula',
  '?':'Other',
  # dlc
  'Gravesite Plain':'Gravesite Plain','Belurat, Tower Settlement':'Gravesite Plain','Castle Ensis':'Gravesite Plain','Enir-Ilim':'Gravesite Plain',
  'Scadu Altus':'Scadu Altus','Shadow Keep':'Scadu Altus','Shadow Keep, Church District':'Scadu Altus','Specimen Storehouse':'Scadu Altus',
  'Rauh':'Rauh','Rauh Base':'Rauh','Ancient Ruins of Rauh':'Rauh',
  'Southern Shore':'Southern Shore','Cerulean Coast':'Southern Shore',"Charo's Hidden Grave":'Southern Shore','Stone Coffin Fissure':'Southern Shore',
  'Jagged Peak':'Jagged Peak','Foot of the Jagged Peak':'Jagged Peak',
  'Abyssal Woods':'Abyssal Woods',"Midra's Manse":'Abyssal Woods',
  'Scaduview':'Scaduview',
  'Other':'Other',
}

def norm(s):
    s = s.lower()
    s = re.sub(r'\s*\(.*?\)\s*','',s)     # drop parenthetical
    s = re.sub(r'[^a-z0-9]+',' ',s).strip()
    return s

# grace name -> subcat (for boss->grace matching), both base+dlc
grace_name2sub = {}
for gid,g in list(graces.items())+list(dlc_graces.items()):
    grace_name2sub.setdefault(norm(g['name']), g.get('subcategory'))

def region_for_sub(sub):
    return SUBCAT2REGION.get(sub, 'Other')

# zone (lowercased) -> region, from data.json + dlcData.json
zone2region = {}
for src in (data, dlcData):
    for region, zones in src.items():
        for z in zones.keys():
            zn = z.lower()
            # first writer wins for dup zone names across regions
            zone2region.setdefault(zn, (region, z))

REGION_SET = {r.lower(): r for r in list(data.keys())+list(dlcData.keys())}
# alt region spellings that appear in boss parentheticals
REGION_ALIAS = {
    'mt. gelmir':'Mt Gelmir','mt gelmir':'Mt Gelmir','forbidden lands':'Mountaintops of the Giants',
    'greyoll’s dragonbarrow':'Dragonbarrow',"greyoll's dragonbarrow":'Dragonbarrow',
    'liurnia south':'Liurnia of the Lakes','liurnia southwest':'Liurnia of the Lakes',
    'liurnia northeast':'Liurnia of the Lakes','liurnia north':'Liurnia of the Lakes',
    'consecrated snowfield, duo':'Consecrated Snowfield',
}

def paren(name):
    m = re.findall(r'\(([^)]*)\)', name)
    return m

def try_region_from_paren(name):
    for p in paren(name):
        pl = p.lower().strip()
        if pl in REGION_SET: return REGION_SET[pl], None
        if pl in REGION_ALIAS: return REGION_ALIAS[pl], None
        if pl in zone2region:
            reg, z = zone2region[pl]; return reg, z
    return None, None

# index: for each (region, zone), collect concatenated item names+hints (lowercased)
zone_text = []  # list of (region, zone, text)
for src in (data, dlcData):
    for region, zones in src.items():
        for z, items in zones.items():
            parts = []
            for it in items.values():
                parts.append(it.get('name',''))
                parts.append(re.sub(r'<[^>]+>',' ', it.get('hint','')))
            zone_text.append((region, z, ' '.join(parts).lower()))

def base_boss_name(name):
    # drop parentheticals, take the most 'proper-noun' chunk
    n = re.sub(r'\s*\(.*?\)\s*','',name)
    # split combined bosses on / or &
    n = re.split(r'[/&]', n)[0].strip()
    return n

def try_region_from_hint(name):
    bn = base_boss_name(name).lower()
    if len(bn) < 5: return None, None
    # require the full base name to appear in a zone's text
    for region, z, txt in zone_text:
        if bn in txt:
            return region, z
    return None, None

# Curated overrides (region, zone, location) — corrects false positives & fills gaps.
OVERRIDE = {
 '15000850':('Consecrated Snowfield',"Miquella's Haligtree","Miquella's Haligtree, first major fight."),
 '11000800':('Altus Plateau','Leyndell Royal Capital','Elden Throne, atop Leyndell, Royal Capital.'),
 '12050800':('Underground','Mohgwyn Palace','Mohgwyn Palace (Bloody Finger teleporter or Consecrated Snowfield portal).'),
 '15000800':('Consecrated Snowfield','Elphael, Brace of the Haligtree','Elphael, Brace of the Haligtree.'),
 '14000800':('Liurnia of the Lakes','Raya Lucaria Academy','Grand Library, Raya Lucaria Academy.'),
 '12030850':('Underground','Deeproot Depths',"Deeproot Depths, during Fia's questline."),
 '16000850':('Mt Gelmir','Volcano Manor','Prison Town Church, Volcano Manor.'),
 '13000800':('Crumbling Farum Azula','Crumbling Farum Azula','Beside the Dragon Temple altar, Crumbling Farum Azula.'),
 '13000850':('Crumbling Farum Azula','Crumbling Farum Azula','Dragon Temple rooftop, Crumbling Farum Azula.'),
 '10010800':('Limgrave','Chapel of Anticipation','Tutorial fight at the Chapel of Anticipation (revisit via the Fourth Church of Marika coffin).'),
 '35000800':('Underground','Subterranean Shunning-Grounds','Subterranean Shunning-Grounds, beneath Leyndell.'),
 '16000860':('Mt Gelmir','Volcano Manor','Volcano Manor.'),
 '1254560800':('Consecrated Snowfield','Consecrated Snowfield','Roams the frozen lake of the Consecrated Snowfield.'),
 '1043360800':('Limgrave','Limgrave','Agheel Lake, central Limgrave.'),
 '1034450800':('Liurnia of the Lakes','Liurnia of the Lakes','Near the Academy Gate Town, Liurnia.'),
 '1050560800':('Consecrated Snowfield','Consecrated Snowfield','Consecrated Snowfield, near the Cave of the Forlorn.'),
 '1049390800':('Underground','Nokstella, Eternal City','Nokstella, Eternal City.'),
 '1050400800':('Dragonbarrow','Dragonbarrow',"Greyoll's Dragonbarrow, below Fort Faroth."),
 '31050800':('Liurnia of the Lakes','Lakeside Crystal Cave','Lakeside Crystal Cave, Liurnia.'),
 '31100800':('Dragonbarrow','Dragonbarrow Cave',"Dragonbarrow Cave, Greyoll's Dragonbarrow."),
 '31200800':('Caelid','Abandoned Cave','Abandoned Cave, Caelid.'),
 '1044360800':('Limgrave','Waypoint Ruins','Waypoint Ruins cellar, Limgrave.'),
 '30030800':('Liurnia of the Lakes',"Road's End Catacombs","Road's End Catacombs, north-west Liurnia."),
 '30070800':('Liurnia of the Lakes','Cliffbottom Catacombs','Cliffbottom Catacombs, Liurnia.'),
 '31150800':('Limgrave','Coastal Cave','Coastal Cave, western Limgrave.'),
 '30200800':('Underground','Nokron, Eternal City','Behind an Imp Statue seal in Nokron, Eternal City.'),
 '12030390':('Underground','Deeproot Depths','Deeproot Depths.'),
 '2049480800':('Scadu Altus','Shadow Keep','Charges near the Shadow Keep drawbridge, Scadu Altus.'),
 '21010800':('Scadu Altus','Shadow Keep','Atop the Shadow Keep / Specimen Storehouse, Scadu Altus.'),
 '2044450800':('Rauh','Ancient Ruins of Rauh','Church of the Bud, Ancient Ruins of Rauh.'),
 '2051450800':('Scadu Altus','Cathedral of Manus Metyr','Cathedral of Manus Metyr (Count Ymir questline), Scadu Altus.'),
 '25000800':('Scadu Altus','Cathedral of Manus Metyr','Finger Ruins beyond the Cathedral of Manus Metyr, Scadu Altus.'),
 '12090800':('Underground','Nokron, Eternal City','Second Hallowhorn Grounds, reached through Nokron.'),
 '14000850':('Liurnia of the Lakes','Raya Lucaria Academy','Debate Parlor, Raya Lucaria Academy.'),
 '16000800':('Mt Gelmir','Volcano Manor','Temple of Eiglay, Volcano Manor.'),
 '19000800':('Altus Plateau','Elden Throne','Final boss at the Erdtree (after Leyndell, Ashen Capital).'),
 '30120800':('Mt Gelmir','Unsightly Catacombs','Unsightly Catacombs, Mt. Gelmir.'),
 '31060800':('Liurnia of the Lakes','Raya Lucaria Crystal Tunnel','Raya Lucaria Crystal Tunnel, Liurnia.'),
 '31070800':('Caelid','Sellia Hideaway','Sellia Hideaway, Caelid.'),
 '31110800':('Caelid','Sellia Crystal Tunnel','Sellia Crystal Tunnel, Caelid.'),
 '32050800':('Altus Plateau','Altus Tunnel','Altus Tunnel, Altus Plateau.'),
 '1037530800':('Caelid','Caelid','On the bridge over the Swamp of Aeonia, Caelid.'),
 '1051360800':('Caelid','Redmane Castle','Redmane Castle plaza, Caelid.'),
 '1052410800':('Dragonbarrow','Dragonbarrow',"Greyoll's Dragonbarrow plateau."),
 '1053560800':('Mountaintops of the Giants',"Lord Contender's Evergaol","Lord Contender's Evergaol, Forbidden Lands."),
 '2046410800':('Gravesite Plain','Gravesite Plain','Gaol Cave near the Three-Path Cross, Gravesite Plain.'),
 '2048440800':('Gravesite Plain','Castle Ensis','Castle Ensis, Gravesite Plain.'),
 '2049430850':('Scadu Altus','Scadu Altus','Scadu Altus.'),
 '2052430800':('Scadu Altus','Cathedral of Manus Metyr','Cathedral of Manus Metyr area, Scadu Altus.'),
 '2054390850':('Rauh','Ancient Ruins of Rauh','Ancient Ruins of Rauh.'),
 '28000800':('Abyssal Woods',"Midra's Manse","Midra's Manse, Abyssal Woods."),
 '2050480800':('Scaduview','Scaduview','Scaduview, before the Fingerprint Stone Wall.'),
}

def last_paren_location(name):
    for p in reversed(paren(name)):
        pl=p.lower().strip()
        if pl in REGION_SET or pl in REGION_ALIAS or pl in zone2region or 'liurnia' in pl:
            return p.strip()
    return ''

# ---- auto-seed bosses ----
seed = {}
via_override=via_grace=via_paren=via_hint=0; unmatched = []
for bid,b in list(bosses.items())+list(dlc_bosses.items()):
    name = b['name']
    reg=None; zone=None; loc=''
    if bid in OVERRIDE:
        reg,zone,loc = OVERRIDE[bid]; via_override+=1
    if not reg:
        reg, zone = try_region_from_paren(name)
        if reg: via_paren+=1
    if not reg:
        sub = grace_name2sub.get(norm(name))
        if sub: reg=region_for_sub(sub); zone=sub; via_grace+=1
    if not reg:
        reg, zone = try_region_from_hint(name)
        if reg: via_hint+=1
    if not reg:
        unmatched.append((bid,name)); reg=''
    if not loc:
        loc = (zone + (', '+reg if zone and zone!=reg else '')) if zone else (last_paren_location(name) or reg)
    seed[bid] = {'name':name,'region':reg,'zone':zone or '','location':loc}

print('TOTAL:',len(seed),'| override:',via_override,'paren:',via_paren,'grace:',via_grace,'hint:',via_hint,'| UNMATCHED:',len(unmatched))
for bid,name in unmatched: print('   UNSET',bid,'|',name)

# ---- outputs into the app ----
OUT = os.path.join(ROOT,'data')
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT,'boss_meta.json'),'w',encoding='utf-8') as f:
    json.dump(seed,f,ensure_ascii=False,indent=1)

region_map = {
  'order': BASE_REGIONS + DLC_REGIONS,
  'baseRegions': BASE_REGIONS,
  'dlcRegions': DLC_REGIONS,
  'graceSubcatToRegion': SUBCAT2REGION,
}
with open(os.path.join(OUT,'region_map.json'),'w',encoding='utf-8') as f:
    json.dump(region_map,f,ensure_ascii=False,indent=1)
print('wrote', OUT, '\\ boss_meta.json + region_map.json')
