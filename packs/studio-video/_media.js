// Media library for Video Studio: import (with a converter fallback for formats the browser cannot play), thumbnails,
// waveforms, decoded audio, and IndexedDB persistence of the original files. Nothing leaves the device.
import { fileType } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import * as idb from '../../lib/idb.js'
import { jszip } from '../../lib/libs.js'
import { uid, clamp } from './_model.js'

const MAX_AUDIO_SECONDS = 30 * 60 // decoded audio is float32 stereo in memory; longer than this plays silent
const IMG_MAX = 2560
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))])

export function kindOf(file) {
  const t = fileType(file)
  return t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : t.startsWith('image/') ? 'image' : null
}

/** Seek a media element and wait until the new frame is ready (resolves after a timeout rather than hanging). */
export function seekTo(el, t, timeout = 4000) {
  return new Promise((resolve) => {
    if (Math.abs(el.currentTime - t) < 0.0005 && el.readyState >= 2 && !el.seeking) return resolve()
    const done = () => { clearTimeout(to); el.removeEventListener('seeked', done); resolve() }
    const to = setTimeout(done, timeout)
    el.addEventListener('seeked', done)
    el.currentTime = t
  })
}

function loadMeta(tag, url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag)
    el.preload = 'metadata'
    el.muted = true
    const to = setTimeout(() => reject(new Error('timeout')), timeout)
    el.onloadedmetadata = () => { clearTimeout(to); resolve(el) }
    el.onerror = () => { clearTimeout(to); reject(new Error('decode')) }
    el.src = url
  })
}

async function mediaDuration(el) {
  if (Number.isFinite(el.duration)) return el.duration
  // Recorded WebM files report Infinity until the end is reached once.
  await seekTo(el, 1e9, 6000)
  const d = Number.isFinite(el.duration) ? el.duration : 0
  el.currentTime = 0
  return d
}

async function makeStrip(url, duration, vw, vh) {
  const n = clamp(Math.ceil(duration / 2), 4, 16)
  const th = 72, tw = clamp(Math.round((th * vw) / vh), 40, 160)
  const c = document.createElement('canvas')
  c.width = n * tw
  c.height = th
  const g = c.getContext('2d')
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = url
  try {
    await withTimeout(new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej }), 10000, 'timeout')
    for (let i = 0; i < n; i++) {
      await seekTo(v, Math.min(duration - 0.05, ((i + 0.5) / n) * duration))
      g.drawImage(v, i * tw, 0, tw, th)
    }
  } finally {
    v.removeAttribute('src')
    v.load()
  }
  return { strip: c.toDataURL('image/jpeg', 0.6), stripN: n }
}

function makeWave(buf) {
  const W = clamp(Math.ceil(buf.duration * 24), 120, 3000), H = 48
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = 'rgba(255,255,255,.82)'
  const chans = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : null].filter(Boolean)
  const per = buf.length / W
  const stride = Math.max(1, Math.floor(per / 64))
  for (let x = 0; x < W; x++) {
    let max = 0
    const end = Math.min(buf.length, Math.floor((x + 1) * per))
    for (const ch of chans) for (let i = Math.floor(x * per); i < end; i += stride) { const a = Math.abs(ch[i]); if (a > max) max = a }
    const h = Math.max(1, Math.min(1, max * 1.15) * H)
    g.fillRect(x, (H - h) / 2, 1, h)
  }
  return c.toDataURL('image/png')
}

async function convertForEditing(file, kind, onStatus) {
  const { runFFmpeg } = await import('../../lib/ffmpeg.js')
  const inName = `in.${(file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}`
  const video = kind === 'video'
  const args = video
    ? ['-i', inName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'out.mp4']
    : ['-i', inName, '-vn', '-c:a', 'aac', '-b:a', '192k', 'out.m4a']
  const out = await runFFmpeg({
    inputs: [{ name: inName, data: file }], args, output: video ? 'out.mp4' : 'out.m4a',
    onProgress: (f, label) => onStatus?.(f == null ? label : `${label} ${Math.round(f * 100)}%`),
  })
  return new File([out], file.name.replace(/\.[^.]+$/, '') + (video ? '.mp4' : '.m4a'), { type: out.type })
}

/** Large data: URLs repeated in many style attributes are slow; a short blob: URL for the same bytes is not. */
export function dataUrlToBlobUrl(dataUrl) {
  const [head, b64] = dataUrl.split(',')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: head.match(/:(.*?);/)?.[1] || 'image/jpeg' }))
}

export class MediaStore {
  constructor(slot) {
    this.slot = slot
    this.items = new Map()
    this.subs = new Set()
    this._q = Promise.resolve()
    this.onPersistFail = null
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn) }
  emit() { for (const f of [...this.subs]) f() }
  get(id) { return this.items.get(id) }
  list() { return [...this.items.values()] }
  key(id) { return `vs:${this.slot}:blob:${id}` }

  async readImage(m) {
    const img = await loadImage(m.blob)
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024
    const k = Math.min(1, IMG_MAX / Math.max(w, h))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k))
    c.height = Math.max(1, Math.round(h * k))
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    m.img = c
    m.width = c.width
    m.height = c.height
    if (!m.thumb) {
      const t = document.createElement('canvas')
      t.height = 96
      t.width = Math.max(1, Math.round((96 * c.width) / c.height))
      const g = t.getContext('2d')
      g.fillStyle = '#111'
      g.fillRect(0, 0, t.width, t.height)
      g.drawImage(c, 0, 0, t.width, t.height)
      m.thumb = t.toDataURL('image/jpeg', 0.7)
    }
  }

  async readTimed(m) {
    m.url = URL.createObjectURL(m.blob)
    const el = await loadMeta(m.kind === 'video' ? 'video' : 'audio', m.url)
    m.duration = await mediaDuration(el)
    if (m.kind === 'video') { m.width = el.videoWidth; m.height = el.videoHeight }
    el.removeAttribute('src')
    if (!m.duration) throw new Error('empty')
    if (m.kind === 'video' && !m.width) throw new Error('no video')
  }

  /** Import a file. Formats the browser cannot play are converted with the in-browser engine (lib/ffmpeg.js). */
  async add(file, { onStatus } = {}) {
    const kind = kindOf(file)
    if (!kind) throw new Error('Use a video, audio or image file.')
    const m = { id: uid('m'), name: file.name, kind, size: file.size, status: 'ok', duration: 0, width: 0, height: 0, blob: file, url: null, audio: undefined, persisted: false }
    if (kind === 'image') {
      m.hasAudio = false
      await this.readImage(m)
    } else {
      try {
        await this.readTimed(m)
      } catch {
        if (m.url) URL.revokeObjectURL(m.url)
        onStatus?.(`Converting ${file.name} so it can be edited. The first conversion downloads the video engine (about 31 MB).`)
        m.blob = await convertForEditing(file, kind, onStatus)
        m.size = m.blob.size
        try { await this.readTimed(m) } catch { throw new Error('This file could not be read, even after converting it.') }
      }
      if (kind === 'audio') m.hasAudio = true
    }
    this.items.set(m.id, m)
    this.persist(m)
    this.decorate(m)
    this.emit()
    return m
  }

  persist(m) {
    return idb.set(this.key(m.id), m.blob).then((ok) => {
      m.persisted = ok
      if (!ok) this.onPersistFail?.(m)
      return ok
    })
  }

  /** Background work after import: filmstrip for video, decoded audio and waveform. Runs one at a time. */
  decorate(m) {
    this._q = this._q.then(async () => {
      try {
        if (m.kind === 'video' && !m.strip) Object.assign(m, await makeStrip(m.url, m.duration, m.width, m.height))
        this.emit()
        if (m.kind !== 'image' && !m.wave && m.hasAudio !== false) await this.ensureAudio(m.id)
      } catch { /* thumbnails are optional */ }
      this.emit()
    })
  }

  /** Decoded audio (AudioBuffer at 48 kHz) or null when the file has no usable audio. Cached. */
  ensureAudio(id) {
    const m = this.items.get(id)
    if (!m || m.kind === 'image' || m.status !== 'ok' || !m.blob) return Promise.resolve(null)
    if (m.audio !== undefined) return Promise.resolve(m.audio)
    m._audioP ??= (async () => {
      let buf = null
      if (m.duration <= MAX_AUDIO_SECONDS) {
        try {
          buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await m.blob.arrayBuffer())
        } catch { buf = null } // no audio track, or a codec the browser cannot decode
      } else m.audioNote = 'Audio is too long to mix in the browser, so this file plays without sound.'
      m.audio = buf
      m.hasAudio = !!buf
      if (buf && !m.wave) m.wave = makeWave(buf)
      this.emit()
      return buf
    })()
    return m._audioP
  }

  metas() {
    return this.list().map((m) => ({
      id: m.id, name: m.name, kind: m.kind, size: m.size, duration: m.duration, width: m.width, height: m.height, hasAudio: m.hasAudio,
      thumb: m.thumb, strip: m.strip, stripN: m.stripN, wave: m.wave, type: m.blob?.type || '',
    }))
  }

  /** Rebuild the library from saved metadata; blobs come from IndexedDB or, when opening a project file, from `blobs`. */
  async restore(metas, blobs = null) {
    for (const meta of metas) {
      const blob = blobs?.get(meta.id) || (await idb.get(this.key(meta.id))) || null
      const m = { ...meta, blob, status: blob ? 'ok' : 'missing', url: null, audio: undefined, persisted: !!blob && !blobs }
      if (blob) {
        try {
          if (m.kind === 'image') await this.readImage(m)
          else m.url = URL.createObjectURL(blob)
        } catch { m.status = 'error' }
        if (blobs) this.persist(m)
      }
      this.items.set(m.id, m)
    }
    for (const m of this.items.values()) if (m.status === 'ok' && m.kind !== 'image' && ((m.kind === 'video' && !m.strip) || (!m.wave && m.hasAudio !== false))) this.decorate(m)
    this.emit()
  }

  remove(id) {
    const m = this.items.get(id)
    if (!m) return
    if (m.url) URL.revokeObjectURL(m.url)
    if (m._stripUrl) URL.revokeObjectURL(m._stripUrl)
    this.items.delete(id)
    idb.del(this.key(id))
    this.emit()
  }

  clear() { for (const id of [...this.items.keys()]) this.remove(id) }
  dispose() { for (const m of this.items.values()) { if (m.url) URL.revokeObjectURL(m.url); if (m._stripUrl) URL.revokeObjectURL(m._stripUrl) } }
}

/** Project file: a ZIP with project.json and the original media files. */
export async function buildProjectZip(project, store) {
  const JSZip = await jszip()
  const z = new JSZip()
  z.file('project.json', JSON.stringify({ app: 'video-studio', v: 1, project, media: store.metas() }))
  for (const m of store.list()) if (m.blob) z.file(`media/${m.id}`, m.blob, { compression: 'STORE' })
  return z.generateAsync({ type: 'blob' })
}

export async function readProjectZip(file) {
  const JSZip = await jszip()
  let z
  try { z = await JSZip.loadAsync(file) } catch { throw new Error('That file is not a Video Studio project (expected a .zip).') }
  const entry = z.file('project.json')
  if (!entry) throw new Error('That ZIP does not contain a Video Studio project.')
  const data = JSON.parse(await entry.async('string'))
  if (data.app !== 'video-studio' || !data.project) throw new Error('That ZIP does not contain a Video Studio project.')
  const blobs = new Map()
  for (const meta of data.media || []) {
    const f = z.file(`media/${meta.id}`)
    if (f) blobs.set(meta.id, new File([await f.async('blob')], meta.name, { type: meta.type || '' }))
  }
  return { project: data.project, media: data.media || [], blobs }
}
