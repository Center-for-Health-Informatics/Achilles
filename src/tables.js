import { readFile } from 'fs/promises'
import { parse } from 'csv-parse/sync'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { batch, query } from './db.js'
import { substitute } from './substitute.js'

const dir = dirname(fileURLToPath(import.meta.url))
const sqlDir = join(dir, '../sql')

// keepExisting: create the results tables only if they are missing, leaving
// rows from earlier runs in place (used when rerunning a subset of analyses).
export async function createResultsTables (resultsDatabaseSchema, { keepExisting = false } = {}) {
  await batch(substitute(
    await readFile(join(sqlDir, 'achilles_analysis_ddl.sql'), 'utf8'),
    { resultsDatabaseSchema }
  ))

  const dropUnlessKept = table => keepExisting
    ? ''
    : `IF OBJECT_ID('${resultsDatabaseSchema}.${table}', 'U') IS NOT NULL DROP TABLE ${resultsDatabaseSchema}.${table};`

  await query(`
    ${dropUnlessKept('achilles_results')}
    IF OBJECT_ID('${resultsDatabaseSchema}.achilles_results', 'U') IS NULL
    CREATE TABLE ${resultsDatabaseSchema}.achilles_results (
      analysis_id   int,
      stratum_1     varchar(255),
      stratum_2     varchar(255),
      stratum_3     varchar(255),
      stratum_4     varchar(255),
      stratum_5     varchar(255),
      count_value   bigint
    );
  `)

  await query(`
    ${dropUnlessKept('achilles_results_dist')}
    IF OBJECT_ID('${resultsDatabaseSchema}.achilles_results_dist', 'U') IS NULL
    CREATE TABLE ${resultsDatabaseSchema}.achilles_results_dist (
      analysis_id   int,
      stratum_1     varchar(255),
      stratum_2     varchar(255),
      stratum_3     varchar(255),
      stratum_4     varchar(255),
      stratum_5     varchar(255),
      count_value   bigint,
      min_value     float,
      max_value     float,
      avg_value     float,
      stdev_value   float,
      median_value  float,
      p10_value     float,
      p25_value     float,
      p75_value     float,
      p90_value     float
    );
  `)
}

// The indexes R Achilles creates on SQL Server by default (createIndices = TRUE,
// inst/csv/post_processing/indices.csv). Atlas's Data Sources reports filter
// achilles_results by analysis_id and strata; without these each report query
// scans the whole table, and a self-joining one (Observation Period's length
// of observation) can run for hours.
const INDEXES = [
  ['idx_ar_aid', 'achilles_results', ['analysis_id']],
  ['idx_ar_s1', 'achilles_results', ['stratum_1']],
  ['idx_ar_s2', 'achilles_results', ['stratum_2']],
  ['idx_ar_aid_s1', 'achilles_results', ['analysis_id', 'stratum_1']],
  ['idx_ar_aid_s1234', 'achilles_results', ['analysis_id', 'stratum_1', 'stratum_2', 'stratum_3', 'stratum_4']],
  ['idx_ard_aid', 'achilles_results_dist', ['analysis_id']],
  ['idx_ard_s1', 'achilles_results_dist', ['stratum_1']],
  ['idx_ard_s2', 'achilles_results_dist', ['stratum_2']]
]

// Creates whichever of INDEXES are missing (by name), so it is safe after a
// partial run or on tables someone indexed by hand. Returns the names created.
export async function createIndexes (resultsDatabaseSchema) {
  const created = []
  for (const [name, table, columns] of INDEXES) {
    const qualified = `${resultsDatabaseSchema}.${table}`
    const r = await query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('${qualified}') AND name = '${name}')
      BEGIN
        CREATE INDEX ${name} ON ${qualified} (${columns.join(', ')});
        SELECT 1 AS created;
      END
    `)
    if (r.recordset?.length) created.push(name)
  }
  return created
}

export async function populateAnalysisTable (resultsDatabaseSchema) {
  const csv = await readFile(join(sqlDir, 'achilles_analysis_details.csv'), 'utf8')
  const rows = parse(csv, { columns: true, trim: true })

  const values = rows.map(r =>
    `(${r.ANALYSIS_ID}, ${sqlStr(r.ANALYSIS_NAME)}, ${sqlStr(r.STRATUM_1_NAME)}, ${sqlStr(r.STRATUM_2_NAME)}, ${sqlStr(r.STRATUM_3_NAME)}, ${sqlStr(r.STRATUM_4_NAME)}, ${sqlStr(r.STRATUM_5_NAME)}, ${r.IS_DEFAULT}, ${sqlStr(r.CATEGORY)})`
  )

  await query(`
    INSERT INTO ${resultsDatabaseSchema}.achilles_analysis
      (analysis_id, analysis_name, stratum_1_name, stratum_2_name, stratum_3_name, stratum_4_name, stratum_5_name, is_default, category)
    VALUES ${values.join(',\n')}
  `)
}

function sqlStr (v) {
  if (!v) return 'NULL'
  return `'${v.replace(/'/g, "''")}'`
}
