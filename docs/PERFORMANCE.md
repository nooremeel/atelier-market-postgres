# Atelier Market — Database & Search Performance Benchmarks

## Overview

This document tracks execution plans, index utilization, and performance benchmarks for the PostgreSQL edition of Atelier Market.

---

## 1. Catalog Full-Text Search (Phase 3)

### 1.1 Query Architecture
The catalog search query uses PostgreSQL's native full-text search engine:
- **Generated Stored Column:** `search_vector tsvector` generated via:
  ```sql
  search_vector tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(immutable_array_to_string(tags, ' '), '')), 'B') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED
  ```
- **GIN Index:** `CREATE INDEX products_search_idx ON products USING GIN (search_vector);`
- **Lexical Parser:** `websearch_to_tsquery('english', :query)` parses natural human searches (handling phrases `"..."`, `or`, `-exclusion`).
- **Relevance Ranking:** `ts_rank(search_vector, q)` ranks results where title matches (weight `A` = 1.0) outrank tags (weight `B` = 0.4) and descriptions (weight `C` = 0.2).

### 1.2 Benchmark Configuration
- **Dataset:** 3,000 catalog products seeded across multiple craft categories and artisan sellers.
- **Environment:** PostgreSQL 16 (Alpine) containerized via Docker on local SSD.
- **Search Query:** `'ceramic bowl'` parsed to tsquery `'''ceram''' & '''bowl'''`.

### 1.3 `EXPLAIN (ANALYZE, BUFFERS)` Execution Plan

```text
Limit  (cost=103.44..103.47 rows=12 width=63) (actual time=0.935..0.937 rows=12 loops=1)
  Buffers: shared hit=208
  ->  Sort  (cost=103.44..103.52 rows=30 width=63) (actual time=0.934..0.935 rows=12 loops=1)
        Sort Key: (ts_rank(p.search_vector, '''ceram'' & ''bowl'''::tsquery)) DESC, p.created_at DESC
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=208
        ->  Bitmap Heap Scan on products p  (cost=21.66..102.76 rows=30 width=63) (actual time=0.518..0.806 rows=299 loops=1)
              Recheck Cond: (search_vector @@ '''ceram'' & ''bowl'''::tsquery)
              Heap Blocks: exact=200
              Buffers: shared hit=205
              ->  Bitmap Index Scan on products_search_idx  (cost=0.00..21.65 rows=30 width=0) (actual time=0.495..0.496 rows=299 loops=1)
                    Index Cond: (search_vector @@ '''ceram'' & ''bowl'''::tsquery)
                    Buffers: shared hit=5
Planning:
  Buffers: shared hit=88
Planning Time: 1.116 ms
Execution Time: 1.014 ms
```

### 1.4 Analysis & Observations
1. **Index Hit:** PostgreSQL utilized `Bitmap Index Scan on products_search_idx` directly. Only 5 shared index buffers were read to locate 299 matching candidate tuples.
2. **Heap Fetching:** `Bitmap Heap Scan` pulled 200 exact heap blocks in memory without disk degradation (`shared hit=205`).
3. **Top-N Heapsort:** Because pagination is bounded (`LIMIT 12`), PostgreSQL executed an in-memory `top-N heapsort` requiring only 27 kB of memory.
4. **Latency:** Total planning time was ~1.1 ms and execution time was ~1.0 ms, providing sub-2ms search responses for 3,000 products.

---

## 2. Interview Defense Points: Full-Text Search vs. B-Tree / LIKE

### Why not `LIKE '%pattern%'` or MongoDB regex?
- **Leading Wildcard Penalty:** A B-Tree index cannot be traversed with a leading wildcard (`%foo`). The database is forced to perform a full sequential scan (`O(N)` cost) across every row, reading and unpacking table blocks.
- **No Linguistic Normalization:** `LIKE` checks byte or character substrings. It cannot stem words (e.g. `ceramics` vs `ceramic`, `running` vs `run`), ignore stop words (`the`, `and`), or handle morphological variations.
- **No Weighting or Relevance Ranking:** `LIKE` returns a binary match/no-match. It cannot rank an item with a keyword in its title higher than an item with an offhand mention in its description.

### What is a GIN (Generalized Inverted Index)?
- Unlike a standard B-Tree index which maps an entire row/key to a tuple ID (1-to-1), a **GIN index** is an inverted index (similar to Lucene/Elasticsearch).
- It splits text documents into distinct normalized lexemes (tokens). Each index entry contains a single lexeme and a posting list of heap pointers (TIDs) where that lexeme occurs.
- When searching for multiple terms (`'ceramic' & 'bowl'`), PostgreSQL looks up the posting lists for `'ceram'` and `'bowl'` and computes their set intersection via a fast bitmap scan in memory.

### What does `ts_rank` do?
- `ts_rank` calculates a document relevance score based on how frequently query lexemes appear in the document and the structural weights assigned during vector construction.
- In our schema:
  - Title lexemes are assigned **Weight A** (default 1.0)
  - Tag lexemes are assigned **Weight B** (default 0.4)
  - Description lexemes are assigned **Weight C** (default 0.2)
- This guarantees that a search for `"lantern"` ranks a product titled `"Damascus Lantern"` above a product whose description casually mentions `"looks great beside a lantern"`.
