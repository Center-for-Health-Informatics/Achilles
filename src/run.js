import { readdir, readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join, basename } from 'path'
import { parse } from 'csv-parse/sync'
import { batch, query } from './db.js'
import { substitute } from './substitute.js'

const dir = dirname(fileURLToPath(import.meta.url))
const sqlDir = join(dir, '../sql')
const analysesDir = join(sqlDir, 'analyses')

async function defaultAnalysisIds () {
  const csv = await readFile(join(sqlDir, 'achilles_analysis_details.csv'), 'utf8')
  return parse(csv, { columns: true, trim: true })
    .filter(r => r.IS_DEFAULT === '1')
    .map(r => parseInt(r.ANALYSIS_ID))
}

export async function runAnalyses (vars, { analysisIds, allAnalyses = false, smallCellCount = 5 } = {}) {
  const { scratchDatabaseSchema, resultsDatabaseSchema, tempAchillesPrefix } = vars

  const allowed = analysisIds ?? (allAnalyses ? null : await defaultAnalysisIds())

  const files = (await readdir(analysesDir))
    .filter(f => /^\d+\.sql$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b))

  const selected = allowed
    ? files.filter(f => allowed.includes(parseInt(f)))
    : files

  for (const file of selected) {
    const id = parseInt(basename(file, '.sql'))
    const raw = await readFile(join(analysesDir, file), 'utf8')
    const sql = substitute(raw, vars)

    // Detect scratch tables from raw SQL before substitution
    const scratchSuffix = `${scratchDatabaseSchema}.${tempAchillesPrefix}`
    const scratchTables = [...new Set(
      [...raw.matchAll(/into\s+@scratchDatabaseSchema@schemaDelim@tempAchillesPrefix(_dist)?_(\d+)/gi)]
        .map(m => `${scratchSuffix}${m[1] ?? ''}_${m[2]}`)
    )]

    for (const t of scratchTables) {
      await query(`IF OBJECT_ID('${t}', 'U') IS NOT NULL DROP TABLE ${t}`)
    }

    process.stdout.write(`  analysis ${id}...`)
    try {
      await batch(sql)
    } catch (e) {
      console.log(` FAILED: ${e.message}`)
      continue
    }

    try {
      for (const t of scratchTables) {
        const isDist = t.includes(`${tempAchillesPrefix}_dist_`)
        if (isDist) {
          await query(`
            INSERT INTO ${resultsDatabaseSchema}.achilles_results_dist
              (analysis_id, stratum_1, stratum_2, stratum_3, stratum_4, stratum_5,
               count_value, min_value, max_value, avg_value, stdev_value,
               median_value, p10_value, p25_value, p75_value, p90_value)
            SELECT analysis_id, stratum_1, stratum_2, stratum_3, stratum_4, stratum_5,
               count_value, min_value, max_value, avg_value, stdev_value,
               median_value, p10_value, p25_value, p75_value, p90_value
            FROM ${t}
            WHERE count_value > ${smallCellCount}
          `)
        } else {
          await query(`
            INSERT INTO ${resultsDatabaseSchema}.achilles_results
              (analysis_id, stratum_1, stratum_2, stratum_3, stratum_4, stratum_5, count_value)
            SELECT analysis_id, stratum_1, stratum_2, stratum_3, stratum_4, stratum_5, count_value
            FROM ${t}
            WHERE count_value > ${smallCellCount}
          `)
        }
        await query(`DROP TABLE ${t}`)
      }
      console.log(' done')
    } catch (e) {
      console.log(` merge FAILED: ${e.message}`)
    }
  }
}
