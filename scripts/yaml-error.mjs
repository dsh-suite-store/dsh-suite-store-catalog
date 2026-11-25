/**
 * Turn a YAML parser error into a sentence a contributor can act on.
 *
 * The parser's own message is accurate and unusable: it names the token class
 * (`BLOCK_AS_IMPLICIT_KEY`) and repeats the offending line, but a first-time
 * contributor writing a bilingual description sees only "not valid YAML". The
 * two failures that actually happen are an unquoted colon and a tab, so those
 * get their own sentence in both languages; everything else keeps the parser's
 * message plus its line and column.
 */

/** Errors whose cause is common enough to explain rather than quote. */
const HINTS = {
  BLOCK_AS_IMPLICIT_KEY: {
    zh: '值里含有未加引号的冒号（英文描述常见）。把整段用双引号包起来，或把冒号改成破折号。',
    en: 'A value contains an unquoted colon (common in English text). Wrap the whole value in double quotes, or replace the colon with a dash.',
  },
  TAB_AS_INDENT: {
    zh: '缩进里用了制表符。YAML 只接受空格缩进。',
    en: 'Indentation contains a tab. YAML accepts spaces only.',
  },
  MISSING_CHAR: {
    zh: '引号或方括号没有闭合。检查这一行前后是否成对。',
    en: 'A quote or bracket is not closed. Check that it is paired on this line.',
  },
  BAD_INDENT: {
    zh: '缩进层级不连续。同一层的字段必须缩进相同。',
    en: 'Indentation jumps levels. Fields at the same depth must share one indent.',
  },
  // Parsing rejects a repeated mapping key, so this reaches the parser's error
  // path before any hand-written scan for duplicates could.
  DUPLICATE_KEY: {
    zh: '同一个映射里出现了重复的键。解析器只保留最后一个，请删掉重复的那一行。',
    en: 'A mapping key appears twice. The parser keeps only the last one — delete the duplicate line.',
  },
}

/**
 * One diagnostic for a YAML parse failure.
 *
 * @param {unknown} error - whatever `parse()` threw.
 * @param {string} path - repository-relative file path.
 * @returns {string} three lines: location, then the zh cause/remedy and the en cause/remedy.
 *   `scripts/check-pr.mjs` splits on exactly this shape.
 */
export function explainYamlError(error, path) {
  const position = Array.isArray(error?.linePos) ? error.linePos[0] : undefined
  // `linePos` comes from the parser and is untyped here: `[null]` or an entry
  // without `line`/`col` would have thrown a TypeError or printed
  // `path:undefined:undefined`.
  const located = typeof position?.line === 'number' && typeof position?.col === 'number'
  const where = located ? `${path}:${String(position.line)}:${String(position.col)}` : path
  // Own-property check: a plain lookup for `code: 'constructor'` finds a
  // function on Object.prototype, passes the `!== undefined` test and prints
  // `zh: undefined`.
  const code = error?.code
  const hint = typeof code === 'string' && Object.hasOwn(HINTS, code) ? HINTS[code] : undefined
  if (hint !== undefined) {
    return `${where}\n  zh: ${hint.zh}\n  en: ${hint.en}`
  }
  // Unknown shape: keep the parser's own words (they name the token) but strip
  // the multi-line echoes, which repeat the file back at the reader.
  const reason = String(error?.message ?? error).split('\n')[0]
  return `${where}\n  zh: YAML 语法错误：${reason}\n  en: YAML syntax error: ${reason}`
}
