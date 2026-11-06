# @chi/achilles

OMOP CDM characterization for SQL Server. Runs the standard Achilles analyses and writes results to `achilles_results`, `achilles_results_dist`, and `achilles_analysis` tables for consumption by Atlas.

This is a Node.js replacement for [OHDSI/Achilles](https://github.com/OHDSI/Achilles). It uses the same SQL analysis files and produces identical output, without the R/Java/JDBC dependency stack.

## Requirements

- Node.js 22+
- SQL Server (tested against Azure SQL Edge)
- An OMOP CDM v5.3 or v5.4 database

## Usage

### Command line

```sh
node index.js \
  --server <host> \
  --database <name> \
  --cdm-schema <schema> \
  --results-schema <schema> \
  --username <user> \
  --password <pass>
```

### Container

Images are published to the CHI registry (`docker login chi-tools.uc.edu`):

```sh
docker run --rm \
  -e ACHILLES_SERVER=<host> \
  -e ACHILLES_DATABASE=<name> \
  -e ACHILLES_CDM_SCHEMA=<schema> \
  -e ACHILLES_RESULTS_SCHEMA=<schema> \
  -e ACHILLES_USERNAME=<user> \
  -e ACHILLES_PASSWORD \
  chi-tools.uc.edu/achilles:1.2.0
```

(`-e ACHILLES_PASSWORD` with no value passes it through from your shell, so it
isn't left in your shell history.)

To build the multi-arch image with Apple's `container` tool, and with
`PUSH=1` scan it and push it (the tag is the version in `package.json`):

```sh
./build.sh
PUSH=1 ./build.sh
```

Results and scratch tables land in `--results-schema` / `ACHILLES_RESULTS_SCHEMA` by default. Use `--scratch-schema` / `ACHILLES_SCRATCH_SCHEMA` to separate them if needed.

## Options

All options can be set via CLI flag or environment variable. CLI flags take precedence.

| CLI option | Env var | Default | Description |
|---|---|---|---|
| `--server` | `ACHILLES_SERVER` | *(required)* | SQL Server hostname or IP |
| `--database` | `ACHILLES_DATABASE` | *(required)* | Database name |
| `--cdm-schema` | `ACHILLES_CDM_SCHEMA` | *(required)* | Schema containing the OMOP CDM tables |
| `--results-schema` | `ACHILLES_RESULTS_SCHEMA` | *(required)* | Schema for results tables |
| `--scratch-schema` | `ACHILLES_SCRATCH_SCHEMA` | results schema | Schema for temporary scratch tables |
| `--username` | `ACHILLES_USERNAME` | | SQL Server login (omit for Windows auth) |
| `--password` | `ACHILLES_PASSWORD` | | SQL Server password |
| `--no-encrypt` | `ACHILLES_NO_ENCRYPT` | | Connect without TLS. By default the connection is encrypted and the server certificate is validated |
| `--trust-server-certificate` | `ACHILLES_TRUST_SERVER_CERTIFICATE` | | Encrypt, but accept the server certificate without validating it (self-signed dev servers) |
| `--cdm-version` | `ACHILLES_CDM_VERSION` | `5.4` | CDM version (`5.3` or `5.4`) |
| `--source-name` | `ACHILLES_SOURCE_NAME` | cdm_source table | CDM source name written to analysis 0 |
| `--achilles-version` | `ACHILLES_VERSION` | package version | Version string written to analysis 0 |
| `--compatible` | `ACHILLES_COMPATIBLE` | | Match R Achilles output where our results intentionally diverge (see below) |
| `--prefix` | `ACHILLES_PREFIX` | `tmpach` | Prefix for scratch tables |
| `--small-cell-count` | `ACHILLES_SMALL_CELL_COUNT` | `5` | Suppress result rows with count ≤ n |
| `--analyses` | `ACHILLES_ANALYSES` | | Comma-separated list of analysis IDs to run |
| `--all-analyses` | `ACHILLES_ALL_ANALYSES` | | Include non-default analyses (slow) |

### Run a subset of analyses

```sh
node index.js --server localhost --database Testing \
  --cdm-schema dbo --results-schema results \
  --username sa --password '...' \
  --analyses 1,2,3,4,5
```

### Non-default analyses

83 of the 300 analyses are excluded by default (`IS_DEFAULT=0` in the Achilles metadata). These include expensive co-occurrence analyses. Pass `--all-analyses` / `ACHILLES_ALL_ANALYSES=1` to include them.

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

| CLI option | Env var | Default | Description |
|---|---|---|---|
| `--server` | `ACHILLES_SERVER` | *(required)* | SQL Server hostname or IP |
| `--database` | `ACHILLES_DATABASE` | *(required)* | Database name |
| `--username` | `ACHILLES_USERNAME` | | SQL Server login |
| `--password` | `ACHILLES_PASSWORD` | | SQL Server password |
| `--no-encrypt` | `ACHILLES_NO_ENCRYPT` | | Connect without TLS. By default the connection is encrypted and the server certificate is validated |
| `--trust-server-certificate` | `ACHILLES_TRUST_SERVER_CERTIFICATE` | | Encrypt, but accept the server certificate without validating it (self-signed dev servers) |
| `--schema-a` | `COMPARE_SCHEMA_A` | `chi_achilles` | First (ours) results schema |
| `--schema-b` | `COMPARE_SCHEMA_B` | `ohdsi_achilles` | Second (reference) results schema |

The comparison automatically handles the known intentional differences described below, treating them as `NOTE` rather than `FAIL`.

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

**analysis_id=1900 (source value completeness):** We correctly include unmapped `visit_detail.admitted_from_source_value` and `visit_detail.discharged_to_source_value` rows when `--cdm-version=5.4`. R Achilles silently omits these due to a SqlRender nested-conditional handling quirk. Pass `--compatible` / `ACHILLES_COMPATIBLE=1` to match the R Achilles behavior and omit these rows.
