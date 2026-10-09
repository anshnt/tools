// Self-check for the pure helpers of this pack. Run: node packs/media-convert/_selftest.mjs
import assert from 'node:assert/strict'
import { parseInfo, fmtTime, parseTime, atempoChain, parseSubtitles, toSrt, pickFonts, capShortSide, pickShortSide, videoKbpsFor, canRemux, parseLoudnorm, parseVolume, streamSig, encodeArgs, audioArgs } from './_media.js'
import { frameTimes } from './video-to-images.js'
import { gifFilter } from './video-to-gif.js'
import { rotateFilters } from './rotate-video.js'
import { forceStyle } from './add-subtitles.js'
import { differences } from './merge-videos.js'
import { kbpsForSize } from './compress-audio.js'

const MP4 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'probe.mp4':
  Duration: 00:00:08.00, start: 0.000000, bitrate: 836 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 640x360 [SAR 1:1 DAR 16:9], 701 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 126 kb/s (default)`
const info = parseInfo(MP4)
assert.equal(info.duration, 8)
assert.equal(info.container, 'mov')
assert.deepEqual([info.video.codec, info.video.pix, info.video.width, info.video.height, info.video.fps], ['h264', 'yuv420p', 640, 360, 25])
assert.deepEqual([info.audio.codec, info.audio.rate, info.audio.channels], ['aac', 44100, 2])
assert.equal(info.rotation, 270)
assert.deepEqual(info.display, { width: 360, height: 640 })

const MP3 = `Input #0, mp3, from 'probe.mp3':
  Metadata:
    title           : Song
    artist          : Band
  Duration: 00:03:00.04, start: 0.025057, bitrate: 192 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 500x500, 90k tbr, 90k tbn (attached pic)`
const mp3 = parseInfo(MP3)
assert.equal(mp3.hasVideo, false, 'cover art is not video')
assert.equal(mp3.tags.title, 'Song')

assert.equal(fmtTime(65.34, 1), '1:05.3')
assert.equal(fmtTime(3725), '1:02:05')
assert.equal(parseTime('1:23.5'), 83.5)
assert.ok(Number.isNaN(parseTime('abc')))
assert.equal(atempoChain(4), 'atempo=2,atempo=2')
assert.equal(atempoChain(0.25), 'atempo=0.5,atempo=0.5')
assert.equal(atempoChain(1.5), 'atempo=1.5')

const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:02,500\nHi <i>there</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nBye')
assert.equal(cues.length, 2)
assert.equal(cues[0].text, 'Hi there')
assert.ok(toSrt(cues, 1).includes('00:00:02,000 --> 00:00:03,500'))
assert.equal(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHello').length, 1)
assert.equal(pickFonts('Hello').family, 'Noto Sans')
assert.equal(pickFonts('नमस्ते').family, 'Noto Sans Devanagari')
assert.deepEqual(pickFonts('你好').unsupported, ['Chinese, Japanese or Korean'])
assert.ok(forceStyle({ family: 'Noto Sans', size: 'medium', style: 'white', pos: 'top' }).includes('Alignment=6'))

assert.deepEqual(capShortSide(1920, 1080, 720), { w: 1280, h: 720 })
assert.deepEqual(capShortSide(1080, 1920, 720), { w: 720, h: 1280 })
assert.equal(pickShortSide(150, 1280, 720, 30), 144)
assert.equal(pickShortSide(6000, 1920, 1080, 30), 1080)
assert.ok(Math.abs(videoKbpsFor(16 * 1024 * 1024, 60, 96) - 2051) < 3)
assert.equal(kbpsForSize(1024 * 1024, 60), 135)

assert.equal(canRemux(info, 'mp4'), true)
assert.equal(canRemux(info, 'webm'), false)
assert.equal(streamSig(info), streamSig(parseInfo(MP4)))
assert.deepEqual(differences([info, parseInfo(MP4.replace('640x360', '1280x720'))]), ['resolution'])

assert.deepEqual(parseLoudnorm('{ "input_i" : "-20.5", "input_tp" : "-3.1", "input_lra" : "1.2", "input_thresh" : "-30.7", "target_offset" : "0.12" }'), { i: -20.5, tp: -3.1, lra: 1.2, thresh: -30.7, offset: 0.12 })
assert.deepEqual(parseVolume('mean_volume: -21.1 dB\nmax_volume: -16.3 dB'), { mean: -21.1, max: -16.3 })

assert.ok(encodeArgs('mp4', { crf: 23, audio: 'copy' }).join(' ').includes('-c:a copy'))
assert.ok(encodeArgs('webm', { vp: 'vp9' }).includes('libvpx-vp9'))
assert.ok(audioArgs('opus', { bitrate: 64, sampleRate: 44100 }).indexOf('-ar') === -1, 'opus has no 44.1 kHz')
assert.equal(audioArgs('wav', { depth: 24 })[1], 'pcm_s24le')

assert.deepEqual(frameTimes({ mode: 'count', duration: 10, count: 2 }), [2.5, 7.5])
assert.equal(frameTimes({ mode: 'interval', duration: 10, every: 5 }).length, 2)
assert.ok(gifFilter({ fps: 12, width: 480, colors: 128, dither: 'bayer:bayer_scale=4' }).includes('palettegen=max_colors=128'))
assert.deepEqual(rotateFilters(180, true, false), ['transpose=1', 'transpose=1', 'hflip'])

console.log('media-convert self-check ok')
