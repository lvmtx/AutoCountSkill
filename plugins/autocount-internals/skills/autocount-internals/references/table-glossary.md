# AutoCount Database Table Glossary

AutoCount's business logic is largely expressed as raw embedded SQL strings, not an ORM —
the same table names recur across dozens of unrelated report/document classes. This is
**not exhaustive**; it's every table this skill's own investigations have actually read
and confirmed the meaning of, compiled so future investigations don't re-derive it from
scratch. Add to this file as new tables get confirmed — don't guess a description in from
the name alone, verify against the SQL that reads it first.

## Stock

| Table | Holds |
|---|---|
| `StockDTL` | Every stock movement transaction line, across every document type (SA, PI, PO, GR, IV, etc.) — `ItemCode`, `Location`, `UOM`, `BatchNo`, `DocDate`, `Seq`, `DocType`, `Qty` (signed: + in, - out), `Cost`/`ReportingCost`/`TotalCost`/`AdjustedCost`. This is THE table for "what happened to this item's stock" — Stock Balance, Stock Card, and Recalculate Cost all read from it. `Seq` (not just `DocDate`) determines same-day ordering for costing/running-balance purposes. |
| `FIFOCOST` | FIFO cost-layer detail per `StockDTLKey` — used when costing method is FIFO/LIFO to track which specific inbound cost layer an outbound transaction consumed. |
| `IPHIST` | Item purchase history — last purchase date/qty/price per item+creditor, used by Supplier Price List's "Last Purchase" columns. Only exists if the IPHIST feature/setting is enabled (`IPHISTSetting.IPHISTExist`); otherwise the same info gets derived live from `PI`/`PO`/`GR`/`CP` unioned with `PastYearPriceHistory`. |
| `PastYearPriceHistory` | Carries forward last-purchase price history across a Year End Closing, since the source `PI`/`PO`/etc. detail rows for the closed year get physically deleted. |
| `ItemPrice` | Supplier Price List — standing negotiated price per supplier(`AccNo`)+item+UOM: `FixedPrice`, tiered `Qty1-4`/`Price1-4` breakpoints, `DetailDiscount1-4`. **No validity/expiry date column** — confirmed by reading its query directly, not by absence of a hit. |
| `ItemUOM` | Per-item unit-of-measure definitions and conversion `Rate` to the base UOM. |
| `ItemBatch` | Batch/lot tracking — `ExpiryDate`, `ManufacturedDate` per item+batch. |
| `Item` | Item master (code, description, `CostingMethod`, `StockControl` flag, `BaseUOM`, `ReportUOM`, active flag). |

## GL / Accounting

| Table | Holds |
|---|---|
| `GLDTL` | Every GL posting line, from every module (AP, AR, CB, JE, stock costing, etc.) — this is the shared ledger detail table GL Ledger reads. Has its own `Description` column, populated (or not) by whatever module posted the entry; a report only shows it if it explicitly selects it (see `ShowTransactionDescription` gotcha in `module-map.md`). |
| `GLMast` | Chart of accounts (account number + description). |
| `PBALANCE` / `OBALANCE` | Period balance / opening balance snapshots per account, used to seed running-balance calculations (e.g. GL Ledger's opening balance) without re-summing the entire transaction history every time. |
| `Location` | Physical stock locations. |
| `Project`, `Dept` | Project and department dimensions, joinable onto most detail tables for project/department-level reporting. |

## Purchase / Sales documents (per DocType — see doctype-glossary.md)

Each document type generally has a `<Code>` master table and a `<Code>DTL` detail table,
e.g. `PI`/`PIDTL` (Purchase Invoice), `PO`/`PODTL` (Purchase Order), `GR`/`GRDTL` (Goods
Received), `CP`/`CPDTL` (Cash Purchase), `CB`/`CBPaymentDTL` (Cash Book), `JE`/`JEDTL`
(Journal Entry), `ADJ`/`ADJDTL` (stock Adjustment — note: separate from `StockDTL`, this
is the document itself), `AssetDisposal` (fixed asset disposal). `DocStatus` on the master
table typically uses `'A'` = Approved, `'V'` = Void — check `DocumentStatusHelper`/
`DocumentStatus` enum in source before assuming a status letter's meaning.

`DocTransfer` tracks document-to-document transfers (e.g. Sales Order → Delivery Order →
Invoice chains, or Assembly Order → Assembly) — `FromDocType`/`FromDocKey` to
`ToDocType`/`ToDocKey`, used to detect "already transferred" / block deletion of a source
document that's been transferred onward.

`Consignment`/`ConsignmentDTL`, `PurchaseConsignment`/`PurchaseConsignmentDTL` and their
`...Return` counterparts follow the same master/detail shape for consignment stock.

## Master data

| Table | Holds |
|---|---|
| `vCreditor` | View over supplier (creditor) master data — used instead of a raw `Creditor` table in most report joins. |
| `vItem` | View over item master data, similarly preferred over raw `Item` in report joins. |
