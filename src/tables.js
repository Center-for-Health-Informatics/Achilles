import { readFile } from 'fs/promises'
import { parse } from 'csv-parse/sync'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { batch, query } from './db.js'
import { substitute } from './substitute.js'

const dir = dirname(fileURLToPath(import.meta.url))
const sqlDir = join(dir, '../sql')

export async function createResultsTables (resultsDatabaseSchema) {
  await batch(substitute(
    await readFile(join(sqlDir, 'achilles_analysis_ddl.sql'), 'utf8'),
    { resultsDatabaseSchema }
  ))

  await query(`
    IF OBJECT_ID('${resultsDatabaseSchema}.achilles_results', 'U') IS NOT NULL
      DROP TABLE ${resultsDatabaseSchema}.achilles_results;
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
    IF OBJECT_ID('${resultsDatabaseSchema}.achilles_results_dist', 'U') IS NOT NULL
      DROP TABLE ${resultsDatabaseSchema}.achilles_results_dist;
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
