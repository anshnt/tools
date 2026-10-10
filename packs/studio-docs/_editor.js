// Editor core: builds the ProseMirror state, plugins, keymap, input rules and views.
import { state as S, view as V, commands as C, history as H, keymap as K, inputrules as IR, schemaList as L, dropcursor as D, gapcursor as G, tables as T } from './vendor/prosemirror.js'
import { schema } from './_schema.js'
import * as cmd from './_cmd.js'
import { findPlugin } from './_find.js'
import { ImageView, TaskItemView } from './_nodeviews.js'

const { EditorState, Plugin, TextSelection } = S
const { EditorView, Decoration, DecorationSet } = V
const N = schema.nodes
const M = schema.marks

function markRule(re, type) {
  return new IR.InputRule(re, (st, match, start, end) => {
    const tr = st.tr.replaceWith(start, end, schema.text(match[1], [type.create()]))
    return tr.removeStoredMark(type)
  })
}

function inputRules() {
  const hr = new IR.InputRule(/^(---|___|\*\*\*)\s$/, (st, match, start, end) => {
    const $s = st.doc.resolve(start)
    if ($s.depth !== 1) return null
    return st.tr.delete(start, end).insert($s.before(), N.horizontal_rule.create())
  })
  return IR.inputRules({
    rules: [
      ...IR.smartQuotes,
      IR.ellipsis,
      IR.textblockTypeInputRule(/^(#{1,6})\s$/, N.heading, (m) => ({ level: m[1].length })),
      IR.wrappingInputRule(/^\s*>\s$/, N.blockquote),
      IR.textblockTypeInputRule(/^```$/, N.code_block),
      IR.wrappingInputRule(/^\s*([-+*])\s$/, N.bullet_list),
      IR.wrappingInputRule(/^(\d+)\.\s$/, N.ordered_list, (m) => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]),
      IR.wrappingInputRule(/^\s*\[\s?\]\s$/, N.task_list),
      hr,
      markRule(/(?<![\w*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, M.strong),
      markRule(/(?<![\w*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, M.em),
      markRule(/(?<![\w_])_([^_\s](?:[^_]*[^_\s])?)_$/, M.em),
      markRule(/(?<![\w~])~~([^~\s](?:[^~]*[^~\s])?)~~$/, M.strike),
      markRule(/(?<!`)`([^`]+)`$/, M.code),
    ],
  })
}

const chain = C.chainCommands

// Enter keeps alignment and indent on the new paragraph (a title or heading continues as normal text)
const splitKeepAttrs = C.splitBlockAs((node, atEnd) => {
  const a = node.attrs
  if (node.type === N.paragraph) return { type: N.paragraph, attrs: { ...a, variant: atEnd ? null : a.variant } }
  if (node.type === N.heading && atEnd) return { type: N.paragraph, attrs: { align: a.align, indent: a.indent, variant: null, lineHeight: null } }
  return null
})

function keymapFor(ctx) {
  const heading = (n) => cmd.setBlockStyle(n ? `h${n}` : 'p')
  const align = (a) => cmd.setBlockAttr('align', a === 'left' ? null : a)
  const keys = {
    'Mod-z': H.undo, 'Mod-y': H.redo, 'Shift-Mod-z': H.redo,
    'Mod-b': cmd.toggleMark(M.strong), 'Mod-i': cmd.toggleMark(M.em), 'Mod-u': cmd.toggleMark(M.underline),
    'Shift-Mod-x': cmd.toggleMark(M.strike), 'Mod-e': align('center'), 'Mod-l': align('left'), 'Mod-r': align('right'), 'Mod-j': align('justify'),
    'Mod-=': cmd.toggleMark(M.sub), 'Shift-Mod-=': cmd.toggleMark(M.sup),
    'Mod-\\': cmd.clearFormatting,
    'Shift-Mod-7': cmd.toggleList(N.ordered_list), 'Shift-Mod-8': cmd.toggleList(N.bullet_list), 'Shift-Mod-9': cmd.toggleList(N.task_list),
    'Mod-Alt-0': heading(0), 'Mod-Alt-1': heading(1), 'Mod-Alt-2': heading(2), 'Mod-Alt-3': heading(3), 'Mod-Alt-4': heading(4), 'Mod-Alt-5': heading(5), 'Mod-Alt-6': heading(6),
    'Mod-Enter': cmd.insertPageBreak,
    'Mod-]': cmd.changeIndent(1), 'Mod-[': cmd.changeIndent(-1),
    'Shift-Mod-.': cmd.stepFontSize(1), 'Shift-Mod-,': cmd.stepFontSize(-1),
    Enter: chain(L.splitListItem(N.task_item), L.splitListItem(N.list_item), C.newlineInCode, C.createParagraphNear, C.liftEmptyBlock, splitKeepAttrs),
    'Shift-Enter': (st, dispatch) => { if (dispatch) dispatch(st.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView()); return true },
    Tab: (st, dispatch, view) => {
      if (cmd.activeList(st) || !cmd.inTable(st)) return cmd.changeIndent(1)(st, dispatch)
      if (T.goToNextCell(1)(st, dispatch)) return true
      if (!dispatch) return true
      T.addRowAfter(st, dispatch) // Tab in the last cell adds a row, like Word
      return T.goToNextCell(1)(view.state, view.dispatch)
    },
    'Shift-Tab': (st, dispatch) => (cmd.activeList(st) || !cmd.inTable(st) ? cmd.changeIndent(-1)(st, dispatch) : T.goToNextCell(-1)(st, dispatch) || true),
  }
  return keys
}

function placeholderPlugin(text) {
  return new Plugin({
    props: {
      decorations(st) {
        const { doc } = st
        if (doc.childCount === 1 && doc.firstChild.type === N.paragraph && doc.firstChild.content.size === 0) {
          return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild.nodeSize, { class: 'dc-empty', 'data-placeholder': text })])
        }
        return null
      },
    },
  })
}

/**
 * createEditor(host, {doc, onChange(tr, state), getZoom, ctx})
 * ctx: {openLink(view), addFiles(files, pos?, view?) -> Promise, openFile(file)}
 */
export function createEditor(host, { doc, onChange, getZoom, ctx = {} }) {
  const plugins = [
    inputRules(),
    K.keymap({ Backspace: IR.undoInputRule }),
    K.keymap(keymapFor(ctx)),
    K.keymap(C.baseKeymap),
    H.history(),
    D.dropCursor({ color: '#5b4cf0', width: 2 }),
    G.gapCursor(),
    T.columnResizing({ cellMinWidth: 48 }),
    T.tableEditing(),
    findPlugin(),
    placeholderPlugin('Start typing, or drop a Word file here'),
    new Plugin({
      props: {
        handlePaste(view, event) {
          const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          event.preventDefault()
          ctx.addFiles?.(files, null, view)
          return true
        },
        handleDrop(view, event, slice, moved) {
          if (moved) return false
          const files = [...(event.dataTransfer?.files || [])]
          if (!files.length) return false
          event.preventDefault()
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const imgs = files.filter((f) => f.type.startsWith('image/'))
          if (imgs.length) ctx.addFiles?.(imgs, at?.pos ?? null, view)
          else ctx.openFile?.(files[0])
          return true
        },
      },
    }),
  ]
  const view = new EditorView(host, {
    state: EditorState.create({ schema, doc, plugins }),
    attributes: { class: 'dc-prose', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document' },
    nodeViews: {
      image: (node, v, getPos) => new ImageView(node, v, getPos, { getZoom }),
      task_item: (node, v, getPos) => new TaskItemView(node, v, getPos),
    },
    dispatchTransaction(tr) {
      const prev = view.state
      const next = prev.apply(tr)
      view.updateState(next)
      onChange?.(tr, next, prev)
    },
  })

  const api = {
    view,
    get state() { return view.state },
    /** Run a command against the live view, keeping focus in the editor. */
    run(command) {
      const ok = command(view.state, view.dispatch, view)
      view.focus()
      return ok
    },
    json: () => view.state.doc.toJSON(),
    /** Replace the whole document (also resets undo history). */
    setDoc(newDoc) {
      const next = EditorState.create({ schema, doc: newDoc, plugins })
      view.updateState(next)
      onChange?.(null, next, null)
    },
    focus: () => view.focus(),
    selectText(pos) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView())
      view.focus()
    },
    destroy: () => view.destroy(),
  }
  return api
}

export const canUndo = (st) => H.undoDepth(st) > 0
export const canRedo = (st) => H.redoDepth(st) > 0
export const undoCmd = H.undo
export const redoCmd = H.redo
