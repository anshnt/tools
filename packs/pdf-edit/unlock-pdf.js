// Remove PDF password: asks for the password, then saves an unprotected copy.
import { h, icon, busy, progress, button, alert, formatBytes } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css } from './_shared.js'

const CSS = `.pe-status { display: flex; gap: 14px; align-items: center; padding: 16px; border-radius: 20px; border: 1px solid var(--border); background: var(--surface); animation: pe-pop .5s var(--spring) both; }
.pe-status .pe-st-icon { width: 48px; height: 48px; border-radius: 15px; display: grid; place-items: center; flex: none; background: var(--accent-soft); color: var(--accent); }
.pe-status .pe-st-icon .icon { width: 24px; height: 24px; }
.pe-status.is-free .pe-st-icon { background: var(--success-soft); color: var(--success); }
.pe-limits { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.pe-limit { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 99px; font-size: 12.5px; background: var(--warning-soft); color: var(--warning); border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent); }
.pe-limit .icon { width: 13px; height: 13px; }`

const FLAGS = [[4, 'Printing'], [8, 'Editing'], [16, 'Copying'], [32, 'Comments'], [256, 'Form filling'], [1024, 'Page assembly']]

/** Which permissions the file restricts, from the /P value of its encryption dictionary. */
export function restrictions(p) {
  if (!Number.isFinite(p)) return []
  return FLAGS.filter(([bit]) => !(p & bit)).map(([, name]) => name)
}

export function mount(root) {
  css('pe-unlock', CSS)
  pdfWorkspace(root, {
    label: 'Drop a password-protected PDF',
    hint: 'You will be asked for its password. Only unlock files you own or may unlock.',
    icon: 'lock-open',
    async onLoad(src, ws) {
      const result = h('div'), prog = progress()
      // does the file carry encryption at all? (pdf.js and our loader open owner-locked files without asking)
      let info = { encrypted: false, perms: [] }
      try {
        const { PDFDocument, PDFName } = await pdfLib()
        const raw = await PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false })
        if (raw.isEncrypted) {
          const enc = raw.context.lookup(raw.context.trailerInfo.Encrypt)
          info = { encrypted: true, perms: restrictions(enc?.lookup(PDFName.of('P'))?.asNumber?.()) }
        }
      } catch { /* treat as not encrypted */ }

      const btn = button(info.encrypted || src.password ? 'Save unlocked copy' : 'Save a clean copy', { icon: 'lock-open', variant: 'primary', size: 'lg', onClick: () => run() })
      async function run() {
        await busy(btn, async () => {
          prog.set(null, 'Removing protection')
          const doc = await src.edit()
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'unlocked'), title: 'Password removed', lead: 'This copy opens without a password and has no usage restrictions.',
            facts: [{ label: 'Pages', value: src.numPages }, { label: 'File size', value: formatBytes(blob.size) }], note: 'Your original file was not changed.', again: ws.reset,
          })
        }, { label: 'Unlocking', errorTo: result, progress: prog })
      }

      const status = info.encrypted || src.password
        ? h('div', { class: 'pe-status' }, h('div', { class: 'pe-st-icon' }, icon(src.password ? 'lock-open' : 'lock')),
          h('div', h('strong', src.password ? 'Password accepted' : 'This PDF has restrictions but opens without a password'),
            h('div', { class: 'small muted' }, src.password ? 'The file is unlocked in your browser. Save a copy without any password.' : 'It is encrypted with an owner password that limits what viewers allow.'),
            info.perms.length ? h('div', { class: 'pe-limits', 'aria-label': 'Restricted actions' }, info.perms.map((p) => h('span', { class: 'pe-limit' }, icon('ban'), p))) : null))
        : h('div', { class: 'pe-status is-free' }, h('div', { class: 'pe-st-icon' }, icon('shield-check')), h('div', h('strong', 'This PDF has no password or restrictions'), h('div', { class: 'small muted' }, 'There is nothing to remove. You can still save a clean copy.')))
      return [status, h('div', { class: 'row' }, btn, h('span', { class: 'small muted' }, 'The password is used only in this tab and is never sent anywhere.')), prog.el, result]
    },
  })
}
