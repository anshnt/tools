// Contacts converter: vCard (.vcf 2.1, 3.0, 4.0) <-> CSV (Google Contacts, Outlook, simple list), Excel and JSON.
import { field, select, toggle } from '../../lib/ui.js'
import { mountConverter, optGroup } from './_shell.js'
import { convertContacts } from './_convert.js'
import { tableToDelimited } from './_formats.js'
import { parseVcf, contactsToTable, contactsToJson, VCARD_SAMPLE, CONTACT_PRESETS } from './_vcard.js'

const LABELS = { vcf: 'vCard (.vcf)', csv: 'CSV', tsv: 'TSV', xlsx: 'Excel (XLSX)', json: 'JSON' }
const EXTS = { vcf: ['vcf', 'vcard'], csv: ['csv', 'txt'], tsv: ['tsv', 'tab', 'txt'], xlsx: ['xlsx', 'xlsm'], json: ['json'] }
const TABLE = new Set(['csv', 'tsv', 'xlsx'])

export function sample(k) {
  const cs = parseVcf(VCARD_SAMPLE)
  if (k === 'vcf') return VCARD_SAMPLE.replace(/\r\n/g, '\n')
  if (k === 'json') return JSON.stringify(contactsToJson(cs), null, 2)
  if (k === 'csv' || k === 'tsv') return tableToDelimited(contactsToTable(cs, 'google'), k === 'tsv' ? '\t' : ',', '\n')
  return ''
}

export function config(params = {}) {
  const list = Object.keys(LABELS).map((k) => [k, LABELS[k]])
  return {
    formats: list, outFormats: list, from: params.from || 'vcf', to: params.to || 'csv', fixed: params.fixed !== false, swappable: true, autoFrom: false,
    defaults: { preset: 'google', photos: undefined, version: '3.0', delimiter: ',', bom: false, sheet: 'first' },
    accept: (k) => EXTS[k].map((e) => `.${e}`).join(','),
    isBinary: (k) => k === 'xlsx',
    sniff: (t) => (/^\s*BEGIN:VCARD/i.test(t) ? 'vcf' : /^\s*[[{]/.test(t) ? 'json' : /\t/.test(t.split('\n')[0]) ? 'tsv' : 'csv'),
    detectName: (n) => { const e = (n.match(/\.([^.]+)$/)?.[1] || '').toLowerCase(); return Object.keys(EXTS).find((k) => EXTS[k].includes(e)) || null },
    sample,
    convert: convertContacts,
    options: (st, changed) => {
      const o = st.opts, t = st.to, f = st.from
      const set = (k) => (v) => { o[k] = v; changed() }
      const photos = () => o.photos ?? !TABLE.has(t)
      const groups = []
      if (TABLE.has(t)) {
        groups.push(optGroup('Columns', field('Column layout', select(CONTACT_PRESETS, o.preset, set('preset')), 'Google Contacts and Outlook CSV files import straight into those apps.'),
          toggle('Include photos (as data links, makes the file big)', photos(), set('photos')),
          t === 'csv' ? field('Separator', select([[',', 'Comma'], [';', 'Semicolon'], ['tab', 'Tab']], o.delimiter, set('delimiter'))) : null,
          t === 'csv' || t === 'tsv' ? toggle('UTF-8 byte order mark (for older Excel)', o.bom, set('bom')) : null))
      }
      if (t === 'vcf') groups.push(optGroup('vCard', field('Version', select([['3.0', '3.0 (works almost everywhere)'], ['4.0', '4.0'], ['2.1', '2.1 (old phones)']], o.version, set('version'))), toggle('Keep photos', photos(), set('photos'))))
      if (t === 'json') groups.push(optGroup('JSON', toggle('Include photos (Base64)', photos(), set('photos'))))
      if (TABLE.has(f) && !groups.length) groups.push(optGroup('Reading the table'))
      return groups.length ? groups : null
    },
    hint: 'Runs in your browser. Your contacts are never uploaded.',
  }
}
export function mount(root, { params = {}, signal }) { return mountConverter(root, { signal, cfg: config(params) }) }
