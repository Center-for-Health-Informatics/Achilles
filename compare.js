import { program } from 'commander'
import { connect, query, close } from './src/db.js'

program
  .name('compare')
  .description('Compare chi_achilles vs ohdsi_achilles output schemas')
  .requiredOption('--server <host>', 'SQL Server host')
  .requiredOption('--database <name>', 'database name')
  .option('--schema-a <schema>', 'first (ours) results schema', 'chi_achilles')
  .option('--schema-b <schema>', 'second (reference) results schema', 'ohdsi_achilles')
  .option('--username <user>', 'SQL Server username')
  .option('--password <pass>', 'SQL Server password')

program.parse()
const opts = program.opts()

const dbConfig = {
  server: opts.server,
  database: opts.database,
  requestTimeout: 300000,
  options: { trustServerCertificate: true, encrypt: false }
}
if (opts.username) {
  dbConfig.user = opts.username
  dbConfig.password = opts.password
} else {
  dbConfig.options.trustedConnection = true
}

const A = opts.schemaA
const B = opts.schemaB

let exitCode = 0

function pass (msg) { console.log(`  PASS  ${msg}`) }
function fail (msg) { console.log(`  FAIL  ${msg}`); exitCode = 1 }
function info (msg) { console.log(`        ${msg}`) }
function section (msg) { console.log(`\n=== ${msg} ===`) }

async function rowCount (schema, table) {
  const r = await query(`SELECT COUNT(*) AS n FROM ${schema}.${table}`)
  return r.recordset[0].n
}

async function compareRowCounts () {
  section('Row counts')
  for (const table of ['achilles_results', 'achilles_results_dist']) {
    const a = await rowCount(A, table)
    const b = await rowCount(B, table)
    if (a === b) {
      pass(`${table}: both have ${a} rows`)
    } else {
      fail(`${table}: ${A}=${a}  ${B}=${b}  (diff ${a - b})`)
    }
  }
}

async function compareAnalysisIds () {
  section('Analysis IDs present in achilles_results')

  const r = await query(`
    SELECT analysis_id FROM ${A}.achilles_results GROUP BY analysis_id
    EXCEPT
    SELECT analysis_id FROM ${B}.achilles_results GROUP BY analysis_id
  `)
  const onlyInA = r.recordset.map(x => x.analysis_id)

  const r2 = await query(`
    SELECT analysis_id FROM ${B}.achilles_results GROUP BY analysis_id
    EXCEPT
    SELECT analysis_id FROM ${A}.achilles_results GROUP BY analysis_id
  `)
  const onlyInB = r2.recordset.map(x => x.analysis_id)

  if (onlyInA.length === 0 && onlyInB.length === 0) {
    pass('Same set of analysis IDs in both schemas')
  } else {
    if (onlyInA.length) fail(`Only in ${A}: ${onlyInA.join(', ')}`)
    if (onlyInB.length) fail(`Only in ${B}: ${onlyInB.join(', ')}`)
  }
}

async function compareAnalysisIdsDist () {
  section('Analysis IDs present in achilles_results_dist')

  const r = await query(`
    SELECT analysis_id FROM ${A}.achilles_results_dist GROUP BY analysis_id
    EXCEPT
    SELECT analysis_id FROM ${B}.achilles_results_dist GROUP BY analysis_id
  `)
  const onlyInA = r.recordset.map(x => x.analysis_id)

  const r2 = await query(`
    SELECT analysis_id FROM ${B}.achilles_results_dist GROUP BY analysis_id
    EXCEPT
    SELECT analysis_id FROM ${A}.achilles_results_dist GROUP BY analysis_id
  `)
  const onlyInB = r2.recordset.map(x => x.analysis_id)

  if (onlyInA.length === 0 && onlyInB.length === 0) {
    pass('Same set of analysis IDs in both schemas')
  } else {
    if (onlyInA.length) fail(`Only in ${A}: ${onlyInA.join(', ')}`)
    if (onlyInB.length) fail(`Only in ${B}: ${onlyInB.join(', ')}`)
  }
}

// For each analysis_id, compare the set of rows by key columns.
// Rows are keyed by (stratum_1..5); we compare count_value.
async function compareResultsDetail () {
  section('achilles_results — per-analysis row-level comparison')

  const ids = await query(`
    SELECT analysis_id
    FROM ${A}.achilles_results
    GROUP BY analysis_id
    ORDER BY analysis_id
  `)

  let perfectCount = 0
  const failedIds = []

  for (const { analysis_id } of ids.recordset) {
    // rows only in A
    const rOnlyA = await query(`
      SELECT stratum_1,stratum_2,stratum_3,stratum_4,stratum_5,count_value
      FROM ${A}.achilles_results WHERE analysis_id=${analysis_id}
      EXCEPT
      SELECT stratum_1,stratum_2,stratum_3,stratum_4,stratum_5,count_value
      FROM ${B}.achilles_results WHERE analysis_id=${analysis_id}
    `)
    // rows only in B
    const rOnlyB = await query(`
      SELECT stratum_1,stratum_2,stratum_3,stratum_4,stratum_5,count_value
      FROM ${B}.achilles_results WHERE analysis_id=${analysis_id}
      EXCEPT
      SELECT stratum_1,stratum_2,stratum_3,stratum_4,stratum_5,count_value
      FROM ${A}.achilles_results WHERE analysis_id=${analysis_id}
    `)

    if (rOnlyA.recordset.length === 0 && rOnlyB.recordset.length === 0) {
      perfectCount++
    } else {
      failedIds.push(analysis_id)
      fail(`analysis_id=${analysis_id}`)
      if (rOnlyA.recordset.length) {
        info(`  rows only in ${A} (${rOnlyA.recordset.length}):`)
        for (const row of rOnlyA.recordset.slice(0, 5)) info(`    ${JSON.stringify(row)}`)
        if (rOnlyA.recordset.length > 5) info(`    ... and ${rOnlyA.recordset.length - 5} more`)
      }
      if (rOnlyB.recordset.length) {
        info(`  rows only in ${B} (${rOnlyB.recordset.length}):`)
        for (const row of rOnlyB.recordset.slice(0, 5)) info(`    ${JSON.stringify(row)}`)
        if (rOnlyB.recordset.length > 5) info(`    ... and ${rOnlyB.recordset.length - 5} more`)
      }
    }
  }

  if (perfectCount > 0) pass(`${perfectCount} analysis IDs match exactly`)
  if (failedIds.length === 0) pass('All analyses match')
}

async function compareResultsDistDetail () {
  section('achilles_results_dist — per-analysis row-level comparison')

  const ids = await query(`
    SELECT analysis_id
    FROM ${A}.achilles_results_dist
    GROUP BY analysis_id
    ORDER BY analysis_id
  `)

  let perfectCount = 0

  for (const { analysis_id } of ids.recordset) {
    // Compare numeric columns with a small tolerance for floating point
    const r = await query(`
      SELECT
        a.stratum_1, a.stratum_2, a.stratum_3, a.stratum_4, a.stratum_5,
        a.count_value  AS a_count,  b.count_value  AS b_count,
        a.min_value    AS a_min,    b.min_value    AS b_min,
        a.max_value    AS a_max,    b.max_value    AS b_max,
        a.avg_value    AS a_avg,    b.avg_value    AS b_avg,
        a.stdev_value  AS a_stdev,  b.stdev_value  AS b_stdev,
        a.median_value AS a_median, b.median_value AS b_median,
        a.p10_value    AS a_p10,    b.p10_value    AS b_p10,
        a.p25_value    AS a_p25,    b.p25_value    AS b_p25,
        a.p75_value    AS a_p75,    b.p75_value    AS b_p75,
        a.p90_value    AS a_p90,    b.p90_value    AS b_p90
      FROM ${A}.achilles_results_dist a
      FULL OUTER JOIN ${B}.achilles_results_dist b
        ON  a.analysis_id = b.analysis_id
        AND ISNULL(a.stratum_1,'') = ISNULL(b.stratum_1,'')
        AND ISNULL(a.stratum_2,'') = ISNULL(b.stratum_2,'')
        AND ISNULL(a.stratum_3,'') = ISNULL(b.stratum_3,'')
        AND ISNULL(a.stratum_4,'') = ISNULL(b.stratum_4,'')
        AND ISNULL(a.stratum_5,'') = ISNULL(b.stratum_5,'')
      WHERE (a.analysis_id = ${analysis_id} OR b.analysis_id = ${analysis_id})
        AND (
          a.analysis_id IS NULL OR b.analysis_id IS NULL  -- unmatched rows (no join partner)
          OR a.count_value  <> b.count_value
          OR ABS(ISNULL(a.min_value,0)    - ISNULL(b.min_value,0))    > 0.0001
          OR ABS(ISNULL(a.max_value,0)    - ISNULL(b.max_value,0))    > 0.0001
          OR ABS(ISNULL(a.avg_value,0)    - ISNULL(b.avg_value,0))    > 0.0001
          OR ABS(ISNULL(a.stdev_value,0)  - ISNULL(b.stdev_value,0))  > 0.0001
          OR ABS(ISNULL(a.median_value,0) - ISNULL(b.median_value,0)) > 0.0001
          OR ABS(ISNULL(a.p10_value,0)    - ISNULL(b.p10_value,0))    > 0.0001
          OR ABS(ISNULL(a.p25_value,0)    - ISNULL(b.p25_value,0))    > 0.0001
          OR ABS(ISNULL(a.p75_value,0)    - ISNULL(b.p75_value,0))    > 0.0001
          OR ABS(ISNULL(a.p90_value,0)    - ISNULL(b.p90_value,0))    > 0.0001
        )
    `)

    if (r.recordset.length === 0) {
      perfectCount++
    } else {
      fail(`analysis_id=${analysis_id} (${r.recordset.length} mismatched rows)`)
      for (const row of r.recordset.slice(0, 3)) info(`    ${JSON.stringify(row)}`)
      if (r.recordset.length > 3) info(`    ... and ${r.recordset.length - 3} more`)
    }
  }

  if (perfectCount > 0) pass(`${perfectCount} analysis IDs match exactly`)
}

try {
  await connect(dbConfig)

  await compareRowCounts()
  await compareAnalysisIds()
  await compareAnalysisIdsDist()
  await compareResultsDetail()
  await compareResultsDistDetail()

  console.log()
  if (exitCode === 0) {
    console.log('All checks passed — outputs are identical.')
  } else {
    console.log('Differences found (see FAIL lines above).')
  }
} finally {
  await close()
  process.exit(exitCode)
}
