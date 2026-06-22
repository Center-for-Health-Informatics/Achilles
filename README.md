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

## How it works

Each numbered file in `sql/analyses/` is a self-contained SQL query that writes to a scratch table. After each query succeeds, its rows are inserted into the final results table and the scratch table is dropped. The process is single-threaded and restartable — if a run is interrupted, the next run drops any leftover scratch tables before proceeding.

`sql/achilles_analysis_details.csv` is the canonical list of analyses and their metadata, copied from the upstream Achilles repository.

## Differences from OHDSI/Achilles

- SQL Server only — no dialect translation layer
- No R, Java, JDBC, or duckdb required
- Single-threaded only (no parallel execution mode)
- No export to JSON/Ares — results stay in the database for Atlas to read directly
- SqlRender's `{@var in (...)} ? {...} : {...}` conditional syntax is supported for CDM version branching
