# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@chi/achilles` is a Node.js (22+, ESM) replacement for R [OHDSI/Achilles](https://github.com/OHDSI/Achilles), limited to SQL Server. It runs the upstream Achilles SQL analyses against an OMOP CDM (5.3/5.4) and writes `achilles_results`, `achilles_results_dist` and `achilles_analysis` for Atlas to read. Its output should match R Achilles row for row, apart from the documented intentional differences in README.md ("Differences from OHDSI/Achilles").

## Commands

```sh
npm ci
node index.js --server <host> --database <db> --cdm-schema <s> --results-schema <s> --username <u> --password <p>
node index.js ... --analyses 1,2,3      # run only some analyses (keeps everyone else's results)
node compare.js --server <host> --database <db> --schema-a chi_achilles --schema-b ohdsi_achilles ...
./build.sh                              # multi-arch image via Apple's `container` tool
PUSH=1 ./build.sh                       # + trivy scan, syft SBOM, push to chi-tools.uc.edu
```

Every CLI flag also has an env var (see the options tables in README.md), named `ACHILLES_*` except for `compare.js`'s `--schema-a`/`--schema-b`, which use `COMPARE_SCHEMA_A`/`COMPARE_SCHEMA_B`. CLI flags win.

There is no test suite, linter or build step. The way to verify a change is to run it against a real SQL Server CDM and, for anything that touches output, run `compare.js` against an R Achilles results schema. `compare.js` reports `PASS`/`FAIL`/`NOTE` and exits 1 on any `FAIL`; known intentional differences (analysis 1900 visit_detail rows, R's timing records with `analysis_id >= 2000000`) and the skipped analysis 0 metadata are `NOTE`s in the per-analysis sections. The row-count section excludes only the timing records, so any extra 1900 rows from a run without `--compatible` still make it `FAIL` and the run exit 1.

## Architecture

The flow (`index.js`): parse options → connect (`src/db.js`, a single module-level `mssql` pool) → `createResultsTables` → `populateAnalysisTable` from the CSV → `runAnalyses` → `createIndexes` → print the `--analyses` list to rerun any failures and exit 1 if there were any.

- **`sql/analyses/<id>.sql`**: one file per analysis, taken from upstream Achilles in SqlRender syntax. Each one `SELECT ... INTO @scratchDatabaseSchema@schemaDelim@tempAchillesPrefix_<id>` (or `..._dist_<id>` for distribution analyses). Only files named `^\d+\.sql$` are run; the other `.sql` files in that directory are upstream leftovers and are ignored.
- **`sql/achilles_analysis_details.csv`**: the canonical list of analyses (copied from upstream). Its `IS_DEFAULT` column decides what runs unless `--all-analyses` or `--analyses` is given, and the CSV also fills `achilles_analysis`.
- **`src/substitute.js`**: a minimal stand-in for SqlRender. It resolves only `{@var in ('a','b')} ? {then} : {else}` conditionals (innermost first, no nested braces inside a branch) and then plain `@var` replacement, using the `vars` object built in `index.js`. Other SqlRender forms (`{@x == 'y'}`, `{@x != ''}`, `{!@x}`) are **not** supported. Today they appear only in the non-numbered files. Nested `in` conditionals work, as in 1900.sql. When adding or updating an analysis, check that its conditionals use the supported form. Variables are replaced with `replaceAll` in the order of the `vars` entries, so a variable name that is a prefix of another would collide.
- **`src/run.js`**: for each selected analysis it does the following:
  1. Finds the scratch tables by regexing the *raw* SQL for `into @scratch...Prefix(_dist)?_<n>`.
  2. Drops any that are left over.
  3. Runs the substituted SQL.
  4. In a single `XACT_ABORT` transaction, optionally deletes that analysis's earlier rows, inserts the scratch rows into the results tables, and drops the scratch tables.

  **Small-cell suppression (`count_value > smallCellCount`) is applied here, at merge time, not in the analysis SQL.** A failed analysis leaves the results tables untouched, and the run carries on.
- **Full vs partial runs**: a full run drops and recreates the results tables. When `--analyses` is given, `keepExisting`/`replaceExisting` are set and only the rerun analyses' rows are replaced.
- **`src/tables.js`**: the results-table DDL and the eight R Achilles indexes. The indexes are created after the analyses, and only the ones that are missing by name. Atlas's Data Sources reports need them.
- **`compare.js`**: a standalone script that compares two results schemas in the same database.

## Conventions and gotchas

- To make output diverge from R Achilles on purpose: gate the R behaviour behind `compatMode` (`--compatible`), document it in README.md, and teach `compare.js` to report it as a `NOTE`.
- The runtime image is distroless: no shell, no npm. Only `node`, `node_modules`, `package*.json` (`index.js` reads the version from `package.json`), `index.js`, `compare.js`, `src/` and `sql/` are copied in. A new top-level runtime file must be added to the Dockerfile's `COPY` lines. Base images are pinned by digest.
- Image tags come from `package.json`'s `version` and are never reused. Bump the version (and the image tag in README.md's `docker run` example) before `PUSH=1`. `build.sh` won't push from a dirty tree unless `FORCE=1` is set. It mentions a `.trivyignore`, but none is checked in.
- Commit messages for releases start with the version, e.g. `1.2.2: ...`.
- The default `--request-timeout` is `0` (no limit) on purpose, because some analyses run for many minutes on a large CDM.
