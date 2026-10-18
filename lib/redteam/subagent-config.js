/**
 * In-place migration for `@deepseek-ai/dsh-tool-subagent` rows in an agent preset.
 *
 * Two independent compatibility problems are solved here:
 *   1. 0.2.1 rejects `persona` / `toolFilter` with an `Object.hasOwn` check.
 *      Earlier templates shipped `toolFilter`, so an existing user preset must
 *      lose those keys without losing the rest of the user's file.
 *   2. 0.2.0 still reads `backgroundMode` (missing means one-shot) and fork
 *      inherits the host recursion budget unless `maxDepth` is explicit.
 *
 * The editor is deliberately line based: the preset keeps comments and user
 * formatting, and the result is re-parsed with the package's own composition
 * reader before it is allowed to reach disk. It never edits block-scalar
 * content or a row owned by another plugin.
 */
import { readCompositionRows } from './preset-composition.js'

const TOOL_SUBAGENT = '@deepseek-ai/dsh-tool-subagent'
const REJECTED_KEYS = new Set(['persona', 'toolFilter'])
const LEAF_KEYS = Object.freeze([
  ['backgroundMode', 'continuable'],
  ['maxDepth', '1'],
])

function indentOf(line) {
  const match = /^ */.exec(line)
  return match ? match[0].length : 0
}

function isBlankOrComment(line) {
  return /^[ \t]*(?:#.*)?$/.test(line)
}

function keyEntry(line, indent) {
  if (indentOf(line) !== indent) return null
  const match = /^([ \t]*)([A-Za-z][A-Za-z0-9_.-]*):(.*)$/.exec(line)
  if (!match) return null
  return { key: match[2], rest: match[3], indent: match[1].length }
}

function inlineScalar(rest) {
  let text = String(rest || '').trim()
  if (!text) return ''
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0]
    let index = 1
    for (; index < text.length; index += 1) {
      if (quote === '"' && text[index] === '\\') {
        index += 1
        continue
      }
      if (text[index] === quote) {
        if (quote === "'" && text[index + 1] === "'") {
          index += 1
          continue
        }
        break
      }
    }
    return text.slice(1, index).replaceAll(quote === "'" ? "''" : '\\"', quote)
  }
  const comment = text.indexOf(' #')
  if (comment >= 0) text = text.slice(0, comment)
  return text.trim()
}

function isBlockHeader(rest) {
  const text = String(rest || '').trim()
  return text.startsWith('|') || text.startsWith('>')
}

/** Index just past a key's indented child block (value mapping or block scalar). */
function childBlockEnd(lines, keyIndex, keyIndent) {
  let index = keyIndex + 1
  while (index < lines.length) {
    const line = lines[index]
    if (isBlankOrComment(line)) {
      index += 1
      continue
    }
    if (indentOf(line) <= keyIndent) break
    index += 1
  }
  return index
}

/** End of one `- id:` row: the next row at the same indent, or a shallower line. */
function rowEnd(lines, start, indent) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isBlankOrComment(lines[index])) continue
    const current = indentOf(lines[index])
    if (current < indent) return index
    if (current === indent && /^[ \t]*-[ \t]+/.test(lines[index])) return index
  }
  return lines.length
}

/** Lines that are literal content of a `|` / `>` block, not YAML structure. */
function scalarContentLines(lines) {
  const skip = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    if (isBlankOrComment(lines[index])) continue
    const match = /^([ \t]*)[A-Za-z][A-Za-z0-9_.-]*:[ \t]*[|>].*$/.exec(lines[index])
    if (!match) continue
    const keyIndent = match[1].length
    let child = index + 1
    while (child < lines.length) {
      if (isBlankOrComment(lines[child])) {
        skip.add(child)
        child += 1
        continue
      }
      if (indentOf(lines[child]) <= keyIndent) break
      skip.add(child)
      child += 1
    }
    index = child - 1
  }
  return skip
}

function findRows(lines, skip = new Set()) {
  const rows = []
  for (let index = 0; index < lines.length; index += 1) {
    if (skip.has(index)) continue
    const match = /^([ \t]*)-[ \t]+id:[ \t]*(.*)$/.exec(lines[index])
    if (!match) continue
    const indent = match[1].length
    rows.push({ start: index, end: rowEnd(lines, index, indent), indent, id: inlineScalar(match[2]) })
  }
  return rows
}

function findDirectEntry(lines, start, end, rowIndent, key) {
  const wanted = rowIndent + 2
  for (let index = start + 1; index < end; index += 1) {
    if (isBlankOrComment(lines[index])) continue
    if (indentOf(lines[index]) <= rowIndent) break
    const entry = keyEntry(lines[index], wanted)
    if (entry && entry.key === key) return { ...entry, index }
  }
  return null
}

function configBlock(lines, row) {
  const entry = findDirectEntry(lines, row.start, row.end, row.indent, 'config')
  if (!entry || inlineScalar(entry.rest) !== '') return null
  let end = entry.index + 1
  while (end < row.end) {
    if (isBlankOrComment(lines[end])) {
      end += 1
      continue
    }
    if (indentOf(lines[end]) <= entry.indent) break
    end += 1
  }
  let keyIndent = -1
  for (let index = entry.index + 1; index < end; index += 1) {
    if (isBlankOrComment(lines[index])) continue
    keyIndent = indentOf(lines[index])
    break
  }
  if (keyIndent < 0) keyIndent = entry.indent + 2
  return { start: entry.index, end, keyIndent }
}

function scanKeys(lines, block, skip = new Set()) {
  const entries = []
  for (let index = block.start + 1; index < block.end; index += 1) {
    if (skip.has(index) || isBlankOrComment(lines[index])) continue
    const entry = keyEntry(lines[index], block.keyIndent)
    if (!entry) continue
    const needsChildren = isBlockHeader(entry.rest) || inlineScalar(entry.rest) === ''
    entries.push({
      ...entry,
      index,
      childEnd: needsChildren ? childBlockEnd(lines, index, block.keyIndent) : index + 1,
    })
  }
  return entries
}

function rowName(lines, row) {
  const entry = findDirectEntry(lines, row.start, row.end, row.indent, 'name')
  return entry ? inlineScalar(entry.rest) : ''
}

/** workflow / ralph 的 startChild 不传 maxDepth，必须显式禁用才能保证叶子节点。 */
function disableDelegationRow(lines, row) {
  const entry = findDirectEntry(lines, row.start, row.end, row.indent, 'disabled')
  if (entry) {
    if (inlineScalar(entry.rest) === 'true') return { removed: [], added: [] }
    const comment = /(#.*)$/.exec(lines[entry.index])
    lines[entry.index] = `${' '.repeat(entry.indent)}disabled: true${comment ? ` ${comment[1]}` : ''}`
    return { removed: [], added: [`${row.id}.disabled=true`] }
  }
  const name = findDirectEntry(lines, row.start, row.end, row.indent, 'name')
  const insertAt = name ? name.index + 1 : row.start + 1
  lines.splice(insertAt, 0, `${' '.repeat(row.indent + 2)}disabled: true`)
  return { removed: [], added: [`${row.id}.disabled=true`] }
}

function migrateRow(lines, row, skip = new Set()) {
  if (row.id === 'tool-workflow' || row.id === 'tool-ralph') return disableDelegationRow(lines, row)
  if (rowName(lines, row) !== TOOL_SUBAGENT) return null
  const block = configBlock(lines, row)
  if (!block) return null
  const entries = scanKeys(lines, block, skip)
  const provider = entries.find((entry) => entry.key === 'provider')
  const toolName = entries.find((entry) => entry.key === 'toolName')
  const providerValue = provider ? inlineScalar(provider.rest) : ''
  const toolValue = toolName ? inlineScalar(toolName.rest) : (providerValue === 'spawn' ? 'subagent' : '')
  const leaf = (providerValue === 'spawn' || providerValue === 'fork')
    && (toolValue === 'subagent' || toolValue === 'subagent_fork')

  const removed = []
  const remove = new Set()
  for (const entry of entries) {
    if (!REJECTED_KEYS.has(entry.key)) continue
    removed.push(entry.key)
    for (let index = entry.index; index < entry.childEnd; index += 1) remove.add(index)
  }

  const added = []
  if (leaf) {
    for (const [key, value] of LEAF_KEYS) {
      if (entries.some((entry) => entry.key === key)) continue
      added.push(`${key}: ${value}`)
    }
  }

  if (removed.length === 0 && added.length === 0) return { removed, added }

  const desiredInsert = provider && !remove.has(provider.index)
    ? provider.index + 1
    : (entries[0] ? entries[0].index : block.start + 1)
  const insertAt = remove.has(desiredInsert)
    ? Math.min(block.end, desiredInsert)
    : desiredInsert

  const replacement = []
  for (let index = row.start; index < row.end; index += 1) {
    if (index === insertAt) replacement.push('__DSH_PURGE_INSERT__')
    if (!remove.has(index)) replacement.push(lines[index])
  }
  if (!replacement.includes('__DSH_PURGE_INSERT__')) replacement.push('__DSH_PURGE_INSERT__')
  const rendered = replacement.flatMap((line) => (
    line === '__DSH_PURGE_INSERT__'
      ? added.map((entry) => `${' '.repeat(block.keyIndent)}${entry}`)
      : [line]
  ))
  lines.splice(row.start, row.end - row.start, ...rendered)
  return { removed, added }
}

function rejectedConfigKeys(rows, found = []) {
  for (const row of rows) {
    if (row.name === TOOL_SUBAGENT && row.config && !Array.isArray(row.config)) {
      for (const key of REJECTED_KEYS) {
        if (Object.hasOwn(row.config, key)) found.push(`${row.id || row.name}.${key}`)
      }
    }
    if (Array.isArray(row.config)) rejectedConfigKeys(row.config, found)
  }
  return found
}

/**
 * Migrate one preset document.
 *
 * @param {string} text - raw `agent.cordis.yml`.
 * @param {string} baseDir - preset directory used to resolve relative plugin names.
 * @returns {{ text: string, changed: boolean, removed: string[], added: string[], error: string }}
 */
export function migrateSubagentConfig(text, baseDir) {
  const original = String(text == null ? '' : text)
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : ''
  const crlf = original.includes('\r\n')
  const body = (bom ? original.slice(1) : original).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = body.split('\n')
  const skip = scalarContentLines(lines)
  const rows = findRows(lines, skip)
  const removed = []
  const added = []

  // Descending order keeps earlier row offsets valid while later rows shrink/grow.
  for (const row of rows.reverse()) {
    const outcome = migrateRow(lines, row, skip)
    if (!outcome) continue
    removed.push(...outcome.removed)
    added.push(...outcome.added)
  }

  let next = lines.join('\n')
  if (crlf) next = next.replace(/\n/g, '\r\n')
  next = bom + next
  const changed = removed.length > 0 || added.length > 0
  if (!changed) return { text: original, changed: false, removed, added, error: '' }

  try {
    const parsed = readCompositionRows(next, baseDir)
    const left = rejectedConfigKeys(parsed)
    if (left.length > 0) {
      return { text: original, changed: false, removed, added, error: `迁移后仍含被拒字段：${left.join(', ')}` }
    }
  } catch (error) {
    return {
      text: original,
      changed: false,
      removed,
      added,
      error: `迁移后预设无法解析：${error && error.message ? error.message : String(error)}`,
    }
  }
  return { text: next, changed, removed, added, error: '' }
}

export { REJECTED_KEYS, TOOL_SUBAGENT }
