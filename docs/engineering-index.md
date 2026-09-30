## NODE_STREAMS

Reference feature:
Bulk Product CSV Import

Location:
apps/api/src/modules/products/import/

Flow:
HTTP request stream
→ byte-limit Transform
→ csv-parse Transform
→ async iteration
→ ProductService
→ PostgreSQL

Purpose:
Process large CSV input incrementally rather than loading the
entire file into application memory.

Related:
BACKPRESSURE
ASYNC_ITERATOR
BOUNDED_CONCURRENCY
BATCH_PROCESSING

## BACKPRESSURE

Reference feature:
Bulk Product CSV Import

Mechanism:
The CSV parser is consumed through async iteration. Product rows
are processed in bounded batches. While a batch is being processed,
downstream consumption pauses and stream buffering propagates
pressure toward the HTTP source.

Purpose:
Prevent a fast producer from overwhelming a slower database-backed
consumer.

## BOUNDED_CONCURRENCY

Reference feature:
Bulk Product CSV Import

Implementation:
Maximum five Product create operations are started per batch.

Purpose:
Gain parallel I/O throughput without creating one Promise/database
operation for every row simultaneously.

## EXTERNAL_INPUT_VALIDATION

Reference feature:
Bulk Product CSV Import

Boundary:
CSV values arrive as external strings and are converted to trusted
typed values only after runtime validation.

## ASYNC_ITERATOR

`ProductImportService.importCsv` consumes parsed rows with `for await`.

## BATCH_PROCESSING

At most five validated rows form a batch; the batch settles before more rows are consumed.

## PARTIAL_FAILURE

Independent valid rows persist through ProductService.create. Row validation and
business failures contribute to the summary; at most 100 failure samples are retained,
with bounded SKU/message lengths. Fatal CSV/limit errors return a safe client error;
already completed creates remain persisted (the import is not atomic).

## Import bounds

25 MiB per request, 100,000 data rows, 64 KiB parser record limit, five concurrent
creates. Required headers: sku, name, priceInMinorUnits, stock. Optional status
accepts ACTIVE/INACTIVE and defaults to ACTIVE. Empty files are rejected.
The JSON Product create endpoint retains its existing request contract.
