// Coordinate systems: find a CRS from an EPSG code, proj4 string, WKT (.prj) or "UTM 52N", and reproject geometries with proj4js.
import { EPSG } from './_epsg.js'
import { mapCoords, eachCoord } from './_util.js'

const PROJ4_URL = 'https://cdn.jsdelivr.net/npm/proj4@2.22.0/+esm'
export const PROJ4_VERSION = '2.22.0'
let P
/** proj4 (MIT), loaded on first use. */
export const proj4lib = async () => (P ||= (await import(PROJ4_URL)).default)
/** Tests can hand in an already loaded proj4. */
export const setProj4 = (p) => { P = p }

export const WGS84 = '+proj=longlat +datum=WGS84 +no_defs'
const UTM = (zone, south, datum) => `+proj=utm +zone=${zone}${south ? ' +south' : ''} ${datum} +units=m +no_defs`

/** [name, proj4] for a numeric EPSG code that is built in (including generated UTM zones), else null. */
export function epsgDef(code) {
  code = Number(code)
  if (EPSG[code]) return EPSG[code]
  const z = code % 100
  if (code >= 32601 && code <= 32660) return [`WGS 84 / UTM zone ${z}N`, UTM(z, false, '+datum=WGS84')]
  if (code >= 32701 && code <= 32760) return [`WGS 84 / UTM zone ${z}S`, UTM(z, true, '+datum=WGS84')]
  if (code >= 26901 && code <= 26923) return [`NAD83 / UTM zone ${z}N`, UTM(z, false, '+datum=NAD83')]
  if (code >= 25828 && code <= 25838) return [`ETRS89 / UTM zone ${z}N`, UTM(z, false, '+ellps=GRS80')]
  if (code >= 32201 && code <= 32260) return [`WGS 72 / UTM zone ${z}N`, UTM(z, false, '+ellps=WGS72')]
  return null
}

/** The short list offered in the tools. 'utm' means "pick the UTM zone from the data". */
export const COMMON_CRS = [
  ['EPSG:4326', 'WGS 84 longitude/latitude (EPSG:4326)'],
  ['EPSG:3857', 'Web Mercator (EPSG:3857)'],
  ['utm', 'UTM, zone chosen from the data'],
  ['EPSG:27700', 'British National Grid (EPSG:27700)'],
  ['EPSG:5179', 'Korea 2000 Unified CS (EPSG:5179)'],
  ['EPSG:5186', 'Korea 2000 Central Belt 2010 (EPSG:5186)'],
  ['EPSG:2097', 'Korean 1985 Central Belt (EPSG:2097)'],
  ['EPSG:5070', 'NAD83 Conus Albers (EPSG:5070)'],
  ['EPSG:2154', 'Lambert-93 France (EPSG:2154)'],
  ['EPSG:3035', 'ETRS89 LAEA Europe (EPSG:3035)'],
]

// Datums that .prj files usually describe without a shift to WGS 84. Matched on the datum name with punctuation removed.
const KOREAN_1985 = '-114.62,475.963,675.0183,1.162,-2.347,-1.592,6.342'
const DATUM_SHIFTS = [
  [/^(d)?korean(datum)?1985$|^(d)?korea1985$/, KOREAN_1985, 'Korean 1985'],
  [/^(d)?(osgb1936|osgb36)$/, '446.448,-125.157,542.06,0.15,0.247,0.842,-20.489', 'OSGB 1936'],
  [/^(d)?tokyo$/, '-146.414,507.337,680.507,0,0,0,0', 'Tokyo'],
  [/^(d)?europeandatum1950$/, '-87,-98,-121,0,0,0,0', 'ED50'],
  [/^(d)?(deutscheshauptdreiecksnetz|dhdn)$/, '598.1,73.7,418.2,0.202,0.045,-2.455,6.7', 'DHDN'],
  [/^(d)?amersfoort$/, '565.4171,50.3319,465.5524,-0.398957,0.343988,-1.877402,4.0725', 'Amersfoort'],
  [/^(d)?ch1903\+?$/, '674.374,15.056,405.346,0,0,0,0', 'CH1903'],
  [/^(d)?(tm75|ireland1975)$/, '482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15', 'TM75'],
  [/^(d)?(hongkong1980)$/, '-162.619,-276.959,-161.764,0.067753,-2.243648,-1.158828,-1.094246', 'Hong Kong 1980'],
  [/^(d)?ggrs1987$/, '-199.87,74.79,246.62,0,0,0,0', 'GGRS87'],
  [/^(d)?(sjtsk|sjtsk05)$/, '570.8,85.7,462.8,4.998,1.587,5.261,3.56', 'S-JTSK'],
]
const normName = (s) => s.toLowerCase().replace(/[^a-z0-9+]/g, '')

/** Add a TOWGS84 clause to a WKT whose datum is known to need one. Returns { wkt, note }. */
function addDatumShift(wkt) {
  if (/TOWGS84/i.test(wkt)) return { wkt }
  let note
  const out = wkt.replace(/(DATUM\s*\[\s*"([^"]+)"\s*,\s*SPHEROID\s*\[[^\]]*\])/i, (m, head, name) => {
    let hit = DATUM_SHIFTS.find(([re]) => re.test(normName(name)))
    // Many Korean .prj files only say "D_Bessel_1841": a Bessel TM belt at 38 N with 200 km false easting is the Korean 1985 system.
    if (!hit && /bessel/i.test(name) && /Transverse_Mercator|Gauss/i.test(wkt) && /latitude_of_origin",\s*38(\.0*)?\]/i.test(wkt) && /false_easting",\s*200000/i.test(wkt)) hit = [0, KOREAN_1985, 'Korean 1985']
    if (!hit) return m
    note = `The .prj does not say how its datum (${hit[2]}) relates to WGS 84, so the standard shift was applied.`
    return `${head},TOWGS84[${hit[1]}]`
  })
  return { wkt: out, note }
}

/**
 * Find a coordinate system. `spec` can be: 'EPSG:5179', '5179', 'urn:ogc:def:crs:EPSG::32652', 'CRS84', 'UTM 52N', 'utm' (needs `center`),
 * a proj4 string ('+proj=...'), or WKT (PROJCS[...], GEOGCS[...], PROJCRS[...]).
 * Returns { id, name, def, notes[], wgs84 } where `def` is what proj4 understands; `wgs84` is true for plain WGS 84 lon/lat.
 */
export function findCrs(spec, { center } = {}) {
  let s = String(spec ?? '').trim()
  if (!s) return null
  const notes = []
  let m
  if (/^(wgs\s?-?84|crs:?84|ogc:crs84|urn:ogc:def:crs:ogc:1\.3:crs84|epsg:?4326|4326)$/i.test(s)) return { id: 'EPSG:4326', name: 'WGS 84', def: WGS84, notes, wgs84: true }
  if (/^utm$/i.test(s)) {
    if (!center) return null
    const zone = Math.min(60, Math.max(1, Math.floor((center[0] + 180) / 6) + 1))
    return findCrs(`EPSG:${center[1] < 0 ? 32700 + zone : 32600 + zone}`)
  }
  if ((m = s.match(/^utm\s*(?:zone)?\s*:?\s*(\d{1,2})\s*([ns])?$/i))) {
    const zone = Number(m[1])
    if (zone < 1 || zone > 60) throw new Error('UTM zones go from 1 to 60.')
    return findCrs(`EPSG:${/s/i.test(m[2] || '') ? 32700 + zone : 32600 + zone}`)
  }
  if ((m = s.match(/(?:^|[:/])(?:epsg)[^\d]*(\d{4,6})\s*$/i)) || (m = s.match(/^(\d{4,6})$/))) {
    const code = Number(m[1])
    const d = epsgDef(code)
    if (!d) throw new Error(`EPSG:${code} is not built in. Paste its proj4 string or WKT instead (for example from a .prj file).`)
    return { id: `EPSG:${code}`, name: d[0], def: d[1], notes, wgs84: false, code }
  }
  if (s.startsWith('+')) return { id: null, name: 'Custom proj4', def: s, notes, wgs84: false }
  if (/^(PROJCS|GEOGCS|GEOGCRS|PROJCRS|BOUNDCRS|COMPD_CS|COMPOUNDCRS|GEODCRS|GEOCCS)\s*\[/i.test(s)) {
    // A known EPSG authority wins: the table carries datum shifts that plain .prj files leave out.
    const auth = [...s.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)].pop()
    if (auth && epsgDef(auth[1]) && /^PROJCS/i.test(s)) {
      const d = epsgDef(auth[1])
      return { id: `EPSG:${auth[1]}`, name: d[0], def: d[1], notes, wgs84: false, code: Number(auth[1]) }
    }
    if (auth && auth[1] === '4326' && /^GEOGCS/i.test(s)) return findCrs('EPSG:4326')
    const r = addDatumShift(s)
    if (r.note) notes.push(r.note)
    const name = (s.match(/^[A-Z_]+\s*\[\s*"([^"]+)"/i) || [])[1] || 'Custom'
    return { id: null, name, def: r.wkt, notes, wgs84: false, wkt: s }
  }
  throw new Error('Could not read that coordinate system. Use an EPSG code like EPSG:5179, a proj4 string starting with +proj, or WKT.')
}

/** Make sure proj4 accepts the CRS, with a plain-words error if not. */
export async function checkCrs(crs) {
  const p = await proj4lib()
  try { return new p.Proj(crs.def) } catch (e) {
    throw new Error(`The coordinate system "${crs.name}" could not be understood${crs.wkt ? ' (its WKT uses a projection this tool does not support)' : ''}.`)
  }
}

/** Build fn([x,y,z?]) -> [x,y,z?] between two CRS objects from findCrs. */
export async function makeTransform(from, to) {
  const p = await proj4lib()
  if (from.def === to.def) return (c) => c
  await checkCrs(from); await checkCrs(to)
  const t = p(from.def, to.def)
  return (c) => {
    try {
      const r = c.length > 2 && Number.isFinite(c[2]) ? t.forward([c[0], c[1], c[2]]) : t.forward([c[0], c[1]])
      return r.every(Number.isFinite) ? r : null
    } catch { return null }
  }
}

/**
 * Reproject a list of features in place-safe fashion (returns new features). Positions that cannot be converted drop the
 * feature's geometry; the number of such features is returned in `lost`.
 */
export async function reprojectFeatures(features, from, to, { onTick } = {}) {
  const fn = await makeTransform(from, to)
  let lost = 0, n = 0
  const out = []
  for (const f of features) {
    let bad = false
    const g = f.geometry && mapCoords(f.geometry, (c) => { const r = fn(c); if (!r) { bad = true; return c } return r })
    if (bad) lost++
    out.push({ ...f, geometry: bad ? null : g })
    if (onTick && ++n % 2000 === 0) await onTick(n / features.length)
  }
  return { features: out, lost }
}

/** True when coordinates cannot be lon/lat (so a projected CRS must be given). */
export function looksProjected(features) {
  let bad = false
  for (const f of features) { eachCoord(f.geometry, (c) => { if (Math.abs(c[0]) > 180.0001 || Math.abs(c[1]) > 90.0001) bad = true }); if (bad) break }
  return bad
}

// ---------- WKT for .prj files ----------
const ELLPS = {
  WGS84: ['WGS_1984', 6378137, 298.257223563, 'WGS 84'], GRS80: ['GRS_1980', 6378137, 298.257222101, 'GRS 1980'],
  bessel: ['Bessel_1841', 6377397.155, 299.1528128, 'Bessel 1841'], airy: ['Airy_1830', 6377563.396, 299.3249646, 'Airy 1830'],
  intl: ['International_1924', 6378388, 297, 'International 1924'], clrk66: ['Clarke_1866', 6378206.4, 294.9786982, 'Clarke 1866'],
  krass: ['Krasovsky_1940', 6378245, 298.3, 'Krassowsky 1940'], WGS72: ['WGS_1972', 6378135, 298.26, 'WGS 72'], mod_airy: ['Airy_Modified', 6377340.189, 299.3249646, 'Airy Modified 1849'],
  clrk80ign: ['Clarke_1880_IGN', 6378249.2, 293.4660212936269, 'Clarke 1880 (IGN)'], evrst30: ['Everest_1830', 6377276.345, 300.8017, 'Everest 1830'],
}
const WKT_GEOG_ESRI = (el, tow) => `GEOGCS["GCS_${el[0]}",DATUM["D_${el[0]}",SPHEROID["${el[0]}",${el[1]},${el[2]}]${tow ? `,TOWGS84[${tow}]` : ''}],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]`
export const WKT_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'
const WKT_WEBMERC = `PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",${WKT_WGS84},PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]`

const parseProj4 = (str) => {
  const o = {}
  for (const t of str.split(/\s+/)) { const m = t.match(/^\+([^=]+)(?:=(.*))?$/); if (m) o[m[1]] = m[2] === undefined ? true : m[2] }
  return o
}
const UNITS = { m: ['Meter', 1], ft: ['Foot', 0.3048], 'us-ft': ['Foot_US', 0.3048006096012192], km: ['Kilometer', 1000] }

/** Make the contents of a .prj file for a CRS, or null when this tool cannot describe it (a note is added to crs.notes). */
export function crsToWkt(crs) {
  if (crs.wgs84) return WKT_WGS84
  if (crs.wkt) return crs.wkt
  const p = parseProj4(crs.def)
  const name = (crs.name || 'Custom').replace(/[^\w ./()+-]/g, '').replace(/\s+/g, '_')
  if (crs.code === 3857) return WKT_WEBMERC
  const datum = p.datum === 'NAD83' ? 'GRS80' : p.datum === 'WGS84' ? 'WGS84' : p.ellps
  const el = ELLPS[datum] || (p.a && p.rf ? ['Custom_Spheroid', Number(p.a), Number(p.rf)] : null)
  if (!el) { crs.notes.push('No .prj written: the ellipsoid is not one this tool can describe.'); return null }
  const geog = p.datum === 'NAD83' ? 'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]' : WKT_GEOG_ESRI(el, p.towgs84)
  if (p.proj === 'longlat') return geog
  const [uName, uFactor] = UNITS[p.units || 'm'] || UNITS.m
  const num = (v, d = 0) => (v === undefined ? d : Number(v))
  const par = (k, v) => `PARAMETER["${k}",${v}]`
  let proj, params
  switch (p.proj) {
    case 'utm': {
      const zone = Number(p.zone)
      proj = 'Transverse_Mercator'
      params = [par('False_Easting', 500000), par('False_Northing', p.south ? 10000000 : 0), par('Central_Meridian', zone * 6 - 183), par('Scale_Factor', 0.9996), par('Latitude_Of_Origin', 0)]
      break
    }
    case 'tmerc':
      proj = 'Transverse_Mercator'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Scale_Factor', num(p.k ?? p.k_0, 1)), par('Latitude_Of_Origin', num(p.lat_0))]
      break
    case 'lcc':
      proj = 'Lambert_Conformal_Conic'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Standard_Parallel_1', num(p.lat_1)), par('Standard_Parallel_2', num(p.lat_2 ?? p.lat_1)), par('Latitude_Of_Origin', num(p.lat_0))]
      break
    case 'aea':
      proj = 'Albers'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Standard_Parallel_1', num(p.lat_1)), par('Standard_Parallel_2', num(p.lat_2)), par('Latitude_Of_Origin', num(p.lat_0))]
      break
    case 'laea':
      proj = 'Lambert_Azimuthal_Equal_Area'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Latitude_Of_Origin', num(p.lat_0))]
      break
    case 'merc':
      proj = 'Mercator'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Standard_Parallel_1', num(p.lat_ts)), par('Scale_Factor', num(p.k ?? p.k_0, 1))]
      break
    case 'stere':
      proj = Math.abs(num(p.lat_0)) === 90 ? 'Stereographic_North_Pole' : 'Stereographic'
      if (num(p.lat_0) === -90) proj = 'Stereographic_South_Pole'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Standard_Parallel_1', num(p.lat_ts ?? p.lat_0)), par('Scale_Factor', num(p.k ?? p.k_0, 1)), par('Latitude_Of_Origin', num(p.lat_0))]
      break
    case 'sterea':
      proj = 'Double_Stereographic'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Scale_Factor', num(p.k ?? p.k_0, 1)), par('Latitude_Of_Origin', num(p.lat_0))]
      break
    case 'eqc':
      proj = 'Equidistant_Cylindrical'
      params = [par('False_Easting', num(p.x_0)), par('False_Northing', num(p.y_0)), par('Central_Meridian', num(p.lon_0)), par('Standard_Parallel_1', num(p.lat_ts))]
      break
    default:
      crs.notes.push(`No .prj written: the "${p.proj}" projection is not one this tool can describe. The proj4 string is: ${crs.def}`)
      return null
  }
  return `PROJCS["${name}",${geog},PROJECTION["${proj}"],${params.join(',')},UNIT["${uName}",${uFactor}]]`
}
