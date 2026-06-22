import { program } from 'commander'
import { connect, close } from './src/db.js'
import { createResultsTables, populateAnalysisTable } from './src/tables.js'
import { runAnalyses } from './src/run.js'

program
  .name('achilles')
  .description('OMOP CDM characterization — SQL Server only')
  .requiredOption('--server <host>', 'SQL Server host')
  .requiredOption('--database <name>', 'database name')
  .requiredOption('--cdm-schema <schema>', 'CDM schema (e.g. dbo)')
  .requiredOption('--results-schema <schema>', 'results schema (e.g. dbo)')
  .option('--scratch-schema <schema>', 'scratch schema (defaults to results schema)')
  .option('--prefix <prefix>', 'scratch table prefix', 'tmpach')
  .option('--small-cell-count <n>', 'suppress cells <= n', v => parseInt(v), 5)
  .option('--cdm-version <version>', 'CDM version (e.g. 5.3 or 5.4)', '5.4')
  .option('--all-analyses', 'include non-default analyses (slower)')
  .option('--analyses <ids>', 'comma-separated analysis IDs to run')
  .option('--username <user>', 'SQL Server username (omit for Windows auth)')
  .option('--password <pass>', 'SQL Server password')

program.parse()
const opts = program.opts()

const scratchSchema = opts.scratchSchema ?? opts.resultsSchema

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

const vars = {
  cdmDatabaseSchema: opts.cdmSchema,
  resultsDatabaseSchema: opts.resultsSchema,
  scratchDatabaseSchema: scratchSchema,
  schemaDelim: '.',
  tempAchillesPrefix: opts.prefix,
  cdmVersion: opts.cdmVersion
}

const analysisIds = opts.analyses
  ? opts.analyses.split(',').map(Number)
  : null

try {
  console.log('Connecting...')
  await connect(dbConfig)

  console.log('Creating results tables...')
  await createResultsTables(opts.resultsSchema)

  console.log('Populating analysis metadata...')
  await populateAnalysisTable(opts.resultsSchema)

  console.log('Running analyses...')
  await runAnalyses(vars, { analysisIds, allAnalyses: opts.allAnalyses, smallCellCount: opts.smallCellCount })

  console.log('Done.')
} finally {
  await close()
}
