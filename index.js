import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { program, Option, InvalidArgumentError } from 'commander'
import { connect, query, close } from './src/db.js'
import { createResultsTables, createIndexes, populateAnalysisTable } from './src/tables.js'
import { runAnalyses } from './src/run.js'

const dir = dirname(fileURLToPath(import.meta.url))
const { version: pkgVersion } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

program
  .name('achilles')
  .description('OMOP CDM characterization — SQL Server only')
  .addOption(new Option('--server <host>', 'SQL Server host').env('ACHILLES_SERVER').makeOptionMandatory())
  .addOption(new Option('--database <name>', 'database name').env('ACHILLES_DATABASE').makeOptionMandatory())
  .addOption(new Option('--cdm-schema <schema>', 'CDM schema (e.g. dbo)').env('ACHILLES_CDM_SCHEMA').makeOptionMandatory())
  .addOption(new Option('--results-schema <schema>', 'results schema').env('ACHILLES_RESULTS_SCHEMA').makeOptionMandatory())
  .addOption(new Option('--scratch-schema <schema>', 'scratch schema (defaults to results schema)').env('ACHILLES_SCRATCH_SCHEMA'))
  .addOption(new Option('--username <user>', 'SQL Server username (omit for Windows auth)').env('ACHILLES_USERNAME'))
  .addOption(new Option('--password <pass>', 'SQL Server password').env('ACHILLES_PASSWORD'))
  .addOption(new Option('--no-encrypt', 'connect without TLS (default: TLS, certificate validated)').env('ACHILLES_NO_ENCRYPT'))
  .addOption(new Option('--trust-server-certificate', 'accept the server certificate without validating it').env('ACHILLES_TRUST_SERVER_CERTIFICATE'))
  .addOption(new Option('--cdm-version <version>', 'CDM version (e.g. 5.3 or 5.4)').env('ACHILLES_CDM_VERSION').default('5.4'))
  .addOption(new Option('--source-name <name>', 'CDM source name (defaults to cdm_source table)').env('ACHILLES_SOURCE_NAME'))
  .addOption(new Option('--achilles-version <ver>', 'version string written to analysis 0').env('ACHILLES_VERSION').default(pkgVersion))
  .addOption(new Option('--compatible', 'match official R Achilles output where our results diverge').env('ACHILLES_COMPATIBLE'))
  .addOption(new Option('--prefix <prefix>', 'scratch table prefix').env('ACHILLES_PREFIX').default('tmpach'))
  .addOption(new Option('--small-cell-count <n>', 'suppress cells <= n').env('ACHILLES_SMALL_CELL_COUNT').default(5).argParser(v => parseInt(v)))
  .addOption(new Option('--analyses <ids>', 'comma-separated analysis IDs to run').env('ACHILLES_ANALYSES'))
  .addOption(new Option('--all-analyses', 'include non-default analyses (slower)').env('ACHILLES_ALL_ANALYSES'))
  .addOption(new Option('--request-timeout <ms>', 'per-query timeout in milliseconds (0 = no limit)').env('ACHILLES_REQUEST_TIMEOUT').default(0).argParser(parseTimeout))

program.parse()
const opts = program.opts()

function parseTimeout (v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError('must be a whole number of milliseconds (0 = no limit)')
  return n
}

const scratchSchema = opts.scratchSchema ?? opts.resultsSchema

const dbConfig = {
  server: opts.server,
  database: opts.database,
  requestTimeout: opts.requestTimeout,
  options: { encrypt: opts.encrypt, trustServerCertificate: Boolean(opts.trustServerCertificate) }
}
if (opts.username) {
  dbConfig.user = opts.username
  dbConfig.password = opts.password
} else {
  dbConfig.options.trustedConnection = true
}

const analysisIds = opts.analyses
  ? opts.analyses.split(',').map(Number)
  : null

try {
  console.log('Connecting...')
  await connect(dbConfig)

  let sourceName = opts.sourceName
  if (!sourceName) {
    try {
      const r = await query(`SELECT TOP 1 cdm_source_name FROM ${opts.cdmSchema}.cdm_source`)
      sourceName = r.recordset[0]?.cdm_source_name ?? ''
    } catch {
      sourceName = ''
    }
  }

  const vars = {
    cdmDatabaseSchema: opts.cdmSchema,
    resultsDatabaseSchema: opts.resultsSchema,
    scratchDatabaseSchema: scratchSchema,
    schemaDelim: '.',
    tempAchillesPrefix: opts.prefix,
    cdmVersion: opts.cdmVersion,
    source_name: sourceName,
    achilles_version: opts.achillesVersion,
    compatMode: opts.compatible ? '1' : '0'
  }

  // A run limited to --analyses keeps every other analysis's results and
  // replaces only the ones it reruns; a full run starts from empty tables.
  const partial = analysisIds !== null
  console.log(partial ? 'Checking results tables...' : 'Creating results tables...')
  await createResultsTables(opts.resultsSchema, { keepExisting: partial })

  console.log('Populating analysis metadata...')
  await populateAnalysisTable(opts.resultsSchema)

  console.log('Running analyses...')
  const failed = await runAnalyses(vars, {
    analysisIds,
    allAnalyses: opts.allAnalyses,
    smallCellCount: opts.smallCellCount,
    replaceExisting: partial
  })

  // After the analyses, as R Achilles does: inserting into unindexed tables is
  // faster, and indexes built once at the end are compact.
  process.stdout.write('Creating indexes...')
  const indexStart = performance.now()
  const created = await createIndexes(opts.resultsSchema)
  console.log(` ${created.length ? `created ${created.length}` : 'all present'} (${((performance.now() - indexStart) / 1000).toFixed(1)}s)`)

  if (failed.length) {
    console.log(`Done, but ${failed.length} ${failed.length === 1 ? 'analysis' : 'analyses'} failed. To rerun only those:`)
    console.log(`  --analyses ${failed.join(',')}   (or ACHILLES_ANALYSES=${failed.join(',')})`)
    process.exitCode = 1
  } else {
    console.log('Done.')
  }
} finally {
  await close()
}
