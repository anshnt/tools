// Garmin FIT activity files (read only): GPS records with time, altitude, heart rate, cadence, speed, power and temperature,
// plus the session summary and saved locations / course points. Written from the public FIT file format description.
import { isNum } from './_util.js'

const FIT_EPOCH = 631065600 // seconds from 1970-01-01 to 1989-12-31
const SEMI = 180 / 2 ** 31
const SPORTS = { 0: 'Generic', 1: 'Running', 2: 'Cycling', 3: 'Transition', 4: 'Fitness equipment', 5: 'Swimming', 6: 'Basketball', 7: 'Soccer', 8: 'Tennis', 10: 'Training', 11: 'Walking', 12: 'Cross country skiing', 13: 'Alpine skiing', 14: 'Snowboarding', 15: 'Rowing', 16: 'Mountaineering', 17: 'Hiking', 18: 'Multisport', 19: 'Paddling', 21: 'E-biking', 25: 'Sailing', 35: 'Stand up paddleboarding', 37: 'Kayaking' }

// base type (low 5 bits) -> [size, reader, invalid]
const TYPES = {
  0: [1, (d, o) => d.getUint8(o), 0xff], 1: [1, (d, o) => d.getInt8(o), 0x7f], 2: [1, (d, o) => d.getUint8(o), 0xff],
  3: [2, (d, o, l) => d.getInt16(o, l), 0x7fff], 4: [2, (d, o, l) => d.getUint16(o, l), 0xffff],
  5: [4, (d, o, l) => d.getInt32(o, l), 0x7fffffff], 6: [4, (d, o, l) => d.getUint32(o, l), 0xffffffff],
  7: [1, null, null], 8: [4, (d, o, l) => d.getFloat32(o, l), NaN], 9: [8, (d, o, l) => d.getFloat64(o, l), NaN],
  10: [1, (d, o) => d.getUint8(o), 0], 11: [2, (d, o, l) => d.getUint16(o, l), 0], 12: [4, (d, o, l) => d.getUint32(o, l), 0], 13: [1, (d, o) => d.getUint8(o), 0xff],
  14: [8, (d, o, l) => Number(d.getBigInt64(o, l)), 0x7fffffff], 15: [8, (d, o, l) => Number(d.getBigUint64(o, l)), Infinity], 16: [8, (d, o, l) => Number(d.getBigUint64(o, l)), 0],
}

export const isFit = (b) => b.length >= 14 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54

const iso = (t) => new Date((t + FIT_EPOCH) * 1000).toISOString().replace('.000Z', 'Z')

/** Parse a FIT file into messages: [{ num, f: { fieldNumber: value } }]. */
function messages(buf) {
  if (!isFit(buf)) throw new Error('This is not a FIT file (the ".FIT" marker is missing).')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const headerSize = buf[0], dataSize = dv.getUint32(4, true)
  const end = Math.min(buf.length, headerSize + dataSize)
  const defs = new Array(16)
  const out = []
  let o = headerSize, lastTs = 0
  while (o < end) {
    const h = buf[o++]
    if (h & 0x80) { // compressed timestamp header
      const local = (h >> 5) & 3, off = h & 0x1f
      const d = defs[local]
      if (!d) throw new Error('The FIT file is damaged (a data message has no definition).')
      lastTs = (lastTs & ~0x1f) + off + (off < (lastTs & 0x1f) ? 32 : 0)
      const m = dataMessage(dv, buf, o, d)
      m.f[253] = lastTs
      out.push(m)
      o += d.size
    } else if (h & 0x40) { // definition
      const hasDev = !!(h & 0x20), local = h & 0x0f
      const little = buf[o + 1] === 0
      const num = dv.getUint16(o + 2, little)
      const nf = buf[o + 4]
      let p = o + 5
      const fields = []
      for (let i = 0; i < nf; i++, p += 3) fields.push({ num: buf[p], size: buf[p + 1], type: buf[p + 2] & 0x1f })
      let devSize = 0
      if (hasDev) { const nd = buf[p++]; for (let i = 0; i < nd; i++, p += 3) devSize += buf[p + 1] }
      defs[local] = { little, num, fields, size: fields.reduce((s, f) => s + f.size, 0) + devSize }
      o = p
    } else {
      const d = defs[h & 0x0f]
      if (!d) throw new Error('The FIT file is damaged (a data message has no definition).')
      if (o + d.size > end) break
      const m = dataMessage(dv, buf, o, d)
      if (isNum(m.f[253])) lastTs = m.f[253]
      out.push(m)
      o += d.size
    }
  }
  return out
}

function dataMessage(dv, buf, o, d) {
  const f = {}
  for (const fld of d.fields) {
    const [size, rd, invalid] = TYPES[fld.type] || TYPES[13]
    if (fld.type === 7) {
      let e = o
      while (e < o + fld.size && buf[e]) e++
      f[fld.num] = new TextDecoder().decode(buf.subarray(o, e))
    } else if (rd && fld.size >= size) {
      const v = rd(dv, o, d.little)
      if (!(v === invalid || (Number.isNaN(invalid) && Number.isNaN(v)))) f[fld.num] = v
    }
    o += fld.size
  }
  return { num: d.num, f }
}

const scaled = (v, scale, offset = 0) => (isNum(v) ? v / scale - offset : undefined)

export function readFit(buf) {
  const msgs = messages(buf)
  const coords = [], times = [], cp = { heartRates: [], cadences: [], speeds: [], powers: [], temperatures: [], distances: [] }
  const extra = []
  let session = null, fileId = null, skippedNoGps = 0
  for (const { num, f } of msgs) {
    if (num === 20) {
      if (!isNum(f[0]) || !isNum(f[1])) { skippedNoGps++; continue }
      const lat = f[0] * SEMI, lon = f[1] * SEMI
      const alt = scaled(f[78] ?? f[2], 5, 500)
      coords.push(isNum(alt) ? [lon, lat, Math.round(alt * 10) / 10] : [lon, lat])
      const i = coords.length - 1
      times[i] = isNum(f[253]) ? iso(f[253]) : null
      cp.heartRates[i] = f[3] ?? null; cp.cadences[i] = f[4] ?? null; cp.powers[i] = f[7] ?? null; cp.temperatures[i] = f[13] ?? null
      cp.distances[i] = scaled(f[5], 100) ?? null
      const sp = scaled(f[73] ?? f[6], 1000); cp.speeds[i] = isNum(sp) ? Math.round(sp * 1000) / 1000 : null
    } else if (num === 18) session = f
    else if (num === 0) fileId = f
    else if (num === 29 || num === 32) {
      const lat = f[num === 29 ? 1 : 2], lon = f[num === 29 ? 2 : 3]
      if (!isNum(lat) || !isNum(lon)) continue
      const props = {}
      const nm = f[num === 29 ? 0 : 6]; if (nm) props.name = nm
      if (num === 32 && isNum(f[1])) props.time = iso(f[1])
      extra.push({ type: 'Feature', properties: { ...props, kind: num === 29 ? 'location' : 'course point' }, geometry: { type: 'Point', coordinates: [lon * SEMI, lat * SEMI] } })
    }
  }
  const features = []
  if (coords.length) {
    const props = {}
    const sport = session && SPORTS[session[5]]
    const start = session && isNum(session[2]) ? iso(session[2]) : times.find(Boolean)
    props.name = [sport || 'Activity', start ? start.slice(0, 10) : ''].filter(Boolean).join(' ')
    if (sport) props.sport = sport
    if (start) props.start_time = start
    if (session) {
      if (isNum(session[9])) props.distance_m = session[9] / 100
      if (isNum(session[7])) props.elapsed_s = session[7] / 1000
      if (isNum(session[8])) props.moving_s = session[8] / 1000
      if (isNum(session[22])) props.ascent_m = session[22]
      if (isNum(session[16])) props.avg_hr = session[16]
      if (isNum(session[17])) props.max_hr = session[17]
      if (isNum(session[11])) props.calories = session[11]
    }
    const cprops = {}
    if (times.some(Boolean)) cprops.times = Array.from({ length: coords.length }, (_, i) => times[i] ?? null)
    for (const [k, arr] of Object.entries(cp)) if (arr.some((v) => v !== null && v !== undefined)) cprops[k] = Array.from({ length: coords.length }, (_, i) => arr[i] ?? null)
    props.coordinateProperties = cprops
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } })
  }
  features.push(...extra)
  const notes = []
  if (!coords.length) notes.push('No GPS positions were found in this FIT file (an indoor activity?).')
  else if (skippedNoGps) notes.push(`${skippedNoGps} record(s) without a GPS position were skipped.`)
  return { features, notes, name: fileId && isNum(fileId[4]) ? iso(fileId[4]).slice(0, 10) : undefined, messages: msgs.length }
}
