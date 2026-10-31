// Calendar converter: iCalendar (.ics) <-> CSV (full detail or the Google Calendar import layout), Excel and JSON.
import { h, field, select, toggle, input } from '../../lib/ui.js'
import { mountConverter, optGroup } from './_shell.js'
import { convertCalendar } from './_convert.js'
import { tableToDelimited } from './_formats.js'
import { parseIcs, itemsToTable, itemsToJson, ICS_SAMPLE, CALENDAR_PRESETS, localTz } from './_ical.js'

const IN = { ics: 'iCalendar (.ics)', csv: 'CSV', tsv: 'TSV', xlsx: 'Excel (XLSX)' }
const OUT = { ics: 'iCalendar (.ics)', csv: 'CSV', tsv: 'TSV', xlsx: 'Excel (XLSX)', json: 'JSON' }
const EXTS = { ics: ['ics', 'ical', 'ifb', 'icalendar'], csv: ['csv', 'txt'], tsv: ['tsv', 'tab', 'txt'], xlsx: ['xlsx', 'xlsm'], json: ['json'] }
const TABLE = new Set(['csv', 'tsv', 'xlsx'])

export function sample(k) {
  if (k === 'ics') return ICS_SAMPLE.replace(/\r\n/g, '\n')
  if (k === 'csv' || k === 'tsv') return tableToDelimited(itemsToTable(parseIcs(ICS_SAMPLE).items, 'full'), k === 'tsv' ? '\t' : ',', '\n')
  if (k === 'json') return JSON.stringify(itemsToJson(parseIcs(ICS_SAMPLE).items), null, 2)
  return ''
}
const zones = () => { try { return Intl.supportedValuesOf('timeZone') } catch { return ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'] } }

export function config(params = {}) {
  return {
    formats: Object.entries(IN), outFormats: Object.entries(OUT), from: params.from || 'ics', to: params.to || 'csv', fixed: params.fixed !== false, swappable: true, autoFrom: false,
    defaults: { preset: 'full', dateFormat: 'mdy', timeFormat: '12h', tzMode: 'keep', tzOut: 'tzid', timeZone: '', dateOrder: 'auto', calName: '', typedXlsx: true, delimiter: ',', bom: false },
    accept: (k) => EXTS[k].map((e) => `.${e}`).join(','),
    isBinary: (k) => k === 'xlsx',
    sniff: (t) => (/^\s*BEGIN:VCALENDAR/i.test(t) ? 'ics' : /\t/.test(t.split('\n')[0]) ? 'tsv' : 'csv'),
    detectName: (n) => { const e = (n.match(/\.([^.]+)$/)?.[1] || '').toLowerCase(); return Object.keys(EXTS).find((k) => EXTS[k].includes(e)) || null },
    sample,
    convert: convertCalendar,
    options: (st, changed) => {
      const o = st.opts, t = st.to, f = st.from
      const set = (k) => (v) => { o[k] = v; changed() }
      const dl = h('datalist', { id: 'fc-zones' }, zones().map((z) => h('option', { value: z })))
      const groups = []
      if (TABLE.has(t)) {
        const tzSel = select([['keep', 'Keep as UTC'], ['local', `My time zone (${localTz()})`]], o.tzMode === 'keep' || o.tzMode === 'local' ? o.tzMode : 'keep', set('tzMode'))
        const tzTxt = input({ placeholder: 'or a zone name, e.g. Europe/London', list: 'fc-zones', 'aria-label': 'Convert UTC times to another time zone', oninput: (e) => { o.tzMode = e.target.value.trim() || tzSel.value; changed() } })
        groups.push(optGroup('Columns', field('Column layout', select(CALENDAR_PRESETS, o.preset, set('preset')), 'The Google layout can be imported at calendar.google.com (Settings, Import).'),
          field('Times that are in UTC', tzSel), tzTxt, dl))
        groups.push(optGroup('Google layout dates', field('Date format', select([['mdy', '03/25/2024'], ['dmy', '25/03/2024'], ['iso', '2024-03-25']], o.dateFormat, set('dateFormat'))), field('Time format', select([['12h', '2:30 PM'], ['24h', '14:30']], o.timeFormat, set('timeFormat'))),
          t === 'csv' ? field('Separator', select([[',', 'Comma'], [';', 'Semicolon'], ['tab', 'Tab']], o.delimiter, set('delimiter'))) : null,
          t === 'csv' || t === 'tsv' ? toggle('UTF-8 byte order mark (for older Excel)', o.bom, set('bom')) : null))
      }
      if (t === 'ics') groups.push(optGroup('Calendar file', field('Calendar name (optional)', input({ value: o.calName, placeholder: 'My events', oninput: (e) => { o.calName = e.target.value; changed() } })),
        field('Times with a time zone', select([['tzid', 'Keep the zone name (TZID)'], ['utc', 'Convert to UTC']], o.tzOut, set('tzOut')), 'Most calendar apps understand zone names. Choose UTC if yours shows wrong times.')))
      if (TABLE.has(f)) groups.push(optGroup('Reading the table',
        field('Time zone for times without one', input({ value: o.timeZone, placeholder: 'blank = floating time', list: 'fc-zones', oninput: (e) => { o.timeZone = e.target.value.trim(); changed() } }), 'Example: America/New_York. Blank keeps times as local clock time.'),
        field('Dates like 03/04/2024', select([['auto', 'Detect from the data'], ['mdy', 'Month first'], ['dmy', 'Day first']], o.dateOrder, set('dateOrder'))), t === 'ics' ? dl : null))
      return groups.length ? groups : null
    },
    hint: 'Runs in your browser. Your calendar is never uploaded.',
  }
}
export function mount(root, { params = {}, signal }) { return mountConverter(root, { signal, cfg: config(params) }) }
