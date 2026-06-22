export function substitute (sql, vars) {
  // Resolve conditionals before @var substitution so {@var in ...} patterns are still intact
  sql = resolveConditionals(sql, vars)
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`@${k}`, v),
    sql
  )
}

// Resolve SqlRender {@var in ('a','b')} ? {then} : {else} conditionals.
// Uses [^{}]* (no nested braces) and loops innermost-first until stable.
function resolveConditionals (sql, vars) {
  const pattern = /\{@(\w+)\s+in\s+\(([^)]+)\)\}\s*\?\s*\{([^{}]*)\}\s*(?::\s*\{([^{}]*)\})?/g
  let prev
  do {
    prev = sql
    sql = sql.replace(pattern, (_, varName, valueList, thenBlock, elseBlock) => {
      const values = valueList.split(',').map(v => v.trim().replace(/^'|'$/g, ''))
      const actual = String(vars[varName] ?? '')
      return values.includes(actual) ? thenBlock : (elseBlock ?? '')
    })
  } while (sql !== prev)
  return sql
}
