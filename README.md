# @chi/achilles

OMOP CDM characterization for SQL Server. Runs the standard Achilles analyses and writes results to `achilles_results`, `achilles_results_dist`, and `achilles_analysis` tables for consumption by Atlas.

This is a Node.js replacement for [OHDSI/Achilles](https://github.com/OHDSI/Achilles). It uses the same SQL analysis files and produces identical output, without the R/Java/JDBC dependency stack.

## Requirements

- Node.js 22+
- SQL Server (tested against Azure SQL Edge)
- An OMOP CDM v5.3 or v5.4 database

## Usage

```sh
node index.js \
  --server <host> \
  --database <name> \
  --cdm-schema <schema> \
  --results-schema <schema> \
  --username <user> \
  --password <pass>
```

Results and scratch tables land in `--results-schema` by default. Use `--scratch-schema` to separate them if needed.

### Options

| Option | Default | Description |
|---|---|---|
| `--server` | *(required)* | SQL Server hostname or IP |
| `--database` | *(required)* | Database name |
| `--cdm-schema` | *(required)* | Schema containing the OMOP CDM tables |
| `--results-schema` | *(required)* | Schema for results tables |
| `--scratch-schema` | results schema | Schema for temporary scratch tables |
| `--username` | | SQL Server login (omit for Windows auth) |
| `--password` | | SQL Server password |
| `--cdm-version` | `5.4` | CDM version (`5.3` or `5.4`) |
| `--source-name` | cdm_source table | CDM source name written to analysis 0 |
| `--achilles-version` | package version | Version string written to analysis 0 |
| `--compatible` | | Match R Achilles output where our results intentionally diverge (see below) |
| `--prefix` | `tmpach` | Prefix for scratch tables |
| `--small-cell-count` | `5` | Suppress result rows with count ≤ n |
| `--analyses` | | Comma-separated list of analysis IDs to run |
| `--all-analyses` | | Include non-default analyses (slow) |

### Run a subset of analyses

```sh
node index.js --server localhost --database Testing \
  --cdm-schema dbo --results-schema results \
  --username sa --password '...' \
  --analyses 1,2,3,4,5
```

### Non-default analyses

83 of the 300 analyses are excluded by default (`IS_DEFAULT=0` in the Achilles metadata). These include expensive co-occurrence analyses. Pass `--all-analyses` to include them.

## Comparing against R Achilles

`compare.js` connects to two result schemas and checks that they agree row-for-row.

```sh
node compare.js \
  --server <host> \
  --database <name> \
  --schema-a chi_achilles \
  --schema-b ohdsi_achilles \
  --username <user> \
  --password <pass>
```

The comparison automatically handles the known intentional differences described below (treating them as PASS or NOTE rather than FAIL).

## How it works

Each numbered file in `sql/analyses/` is a self-contained SQL query that writes to a scratch table. After each query succeeds, its rows are inserted into the final results table and the scratch table is dropped. The process is single-threaded and restartable — if a run is interrupted, the next run drops any leftover scratch tables before proceeding.

`sql/achilles_analysis_details.csv` is the canonical list of analyses and their metadata, copied from the upstream Achilles repository.

## Differences from OHDSI/Achilles

### Intentional omissions

- **SQL Server only** — no dialect translation layer
- **No R, Java, JDBC, or duckdb required**
- **Single-threaded only** — no parallel execution mode
- **No export to JSON/Ares** — results stay in the database for Atlas to read directly
- **No performance timing records** — R Achilles writes execution timing for each analysis as `analysis_id = original_id + 2000000`. We omit these.

### Behavioral differences

**analysis_id=1900 (source value completeness):** We correctly include unmapped `visit_detail.admitted_from_source_value` and `visit_detail.discharged_to_source_value` rows when `--cdm-version=5.4`. R Achilles silently omits these due to a SqlRender nested-conditional handling quirk. Pass `--compatible` to match the R Achilles behavior and omit these rows.

### Technical notes

- SqlRender's `{@var in (...)} ? {...} : {...}` conditional syntax is supported, including nested conditionals, which R's SqlRender handles inconsistently in some cases.
