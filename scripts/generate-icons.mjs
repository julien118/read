#!/usr/bin/env node
// Generates solid-color PNG icons for the PWA manifest without external deps.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(data) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function u32(n) {
  return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}
function chunk(type, data) {
  const t = Buffer.from(type)
  return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))])
}
function makePNG(w, h, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = chunk('IHDR', Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]))
  const row = Buffer.allocUnsafe(1 + w * 3)
  row[0] = 0
  for (let i = 0; i < w; i++) { row[1 + i * 3] = r; row[2 + i * 3] = g; row[3 + i * 3] = b }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const idat = chunk('IDAT', deflateSync(raw))
  const iend = chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, ihdr, idat, iend])
}

mkdirSync('public/icons', { recursive: true })
// Navy #1a1a2e
writeFileSync('public/icons/icon-192.png', makePNG(192, 192, 26, 26, 46))
writeFileSync('public/icons/icon-512.png', makePNG(512, 512, 26, 26, 46))
console.log('Icons generated.')
