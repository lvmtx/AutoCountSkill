# Known Findings

Concrete mechanisms confirmed by actually reading the source (and often the wiki too)
during real investigations, kept here so the next investigation starts from the answer
instead of re-deriving it. Each entry names the exact class/file so it can be
re-verified if AutoCount's behavior ever seems to have changed. Add new findings here
as they're confirmed — don't add speculation, only things actually traced to source.

## GL Ledger's Description column isn't hidden — it's not fetched at all

The GL Ledger report (hosted in `FormAccountInquiry` → `UCLedger`, both under
`AutoCount.Inquiry`/`AutoCount.Accounting.UI`) has a **"Show Transaction Description"**
checkbox that's unchecked by default. When off, `Ledger.cs`'s SQL builder literally omits
`A.Description` from the SELECT — the column doesn't exist in the grid's data source at
all, so Column Chooser has nothing to offer. Ticking the checkbox and re-inquiring adds
the column to the underlying query; only then does Column Chooser control it.

## Recalculate Stock Costing never touches Qty, DocDate, or Seq

`RecalculateStockCostingSQL.cs`'s only `UPDATE StockDTL` statements touch
`Cost/ReportingCost/TotalCost/ReportingTotalCost/AdjustedCost/InputCost/CostType` —
never quantity or ordering fields. If a stock quantity looks wrong after running
Recalculate Cost, the recalculation itself didn't cause it — look at what stock
adjustment/take/take documents were actually posted instead.

## Stock Balance vs. Stock Card can disagree because they're independently-implemented formulas

- **Stock Balance**: one query, `SUM(Qty) WHERE DocDate <= @FromDate` — a flat snapshot.
- **Stock Card**: opening balance `SUM(Qty) WHERE DocDate < @FromDate` (strictly before)
  plus a client-side running-total walk over `Detail` rows `>= @FromDate` in
  `CalculateStockCards()` (`StockCard.cs`), grouped by Location/UOM/BatchNo — each group
  transition re-seeds its running total from that group's own opening balance row.

These should mathematically agree for the same "as of" date — a real divergence usually
means either (a) the two reports were actually run with different From/To dates, or
(b) the item has more than one Location/Batch/UOM group in its history and the group
being displayed isn't the one you think it is. Recalculate Cost is not a suspect (see
above). See the DocType glossary for `SA` (Stock Adjustment) vs `SK` (Stock Take) —
a Stock Take's "Different Qty" auto-generates its own Stock Adjustment document, so two
independently-created -1 adjustments on the same item/day is an easy way to end up
one unit further off than intended.

## "Please enable Approval in Documents" — one guard, many trigger points

`InvoicingDocument.cs` (base class for QT/SO/DO/IV/CN/DN/XS/DR/CG/CR — see
`myApprovalDocumentTypes`) throws `BaseStringId.ErrorPleaseEnableApprovalInDocuments`
from `Approve()`, `Reject()`, `SaveAsDraft()`, `SaveAsAwaitingApproval()`,
`SaveAndApproved()`, and `SaveAsExpiry()` whenever `DocumentStatusHelper
.EnableApprovalInDocuments(dbSetting, docType)` is false for that doc type. Fix is in
`FormOptionApprovalWorkflow.cs` (Tools → Options → Document Approval) — one checkbox
per doc type, captioned exactly after the doc type name (e.g. `chkEnableApprovalInInvoice`
= "Invoice"). The wiki has a troubleshooting article for this exact symptom titled
"Unable to approve... Please enable Approval in Documents".

## Year End Closing physically deletes transaction detail — there's no built-in undo

Confirmed in `YearEndClosing.cs`: raw `DELETE FROM GLDTL/JE/JEDTL/CB/CBDTL/TaxTrans/
BankTrans/ADJ/ADJDTL/AssetDisposal/...` for everything dated on/before the fiscal year
end cutoff. Only closing balances survive (General Maintenance → Last Year Balance
Maintenance, for comparison reports). The closing process itself never creates a backup —
the wiki's official procedure requires backing up manually as the very first step, and
the only way to see detailed transactions again afterward is restoring that backup as a
separate standalone account book (it does not merge back into the live one).

## Stock Assembly consumes BOM components automatically; Disassembly reverses it

`StockAssembly.cs` (`AutoCount.Manufacturing.StockAssembly`) auto-loads the finished
item's Bill of Materials (`LoadItemBOMData`/`LoadAllBOMItems`) and flags component detail
rows as `IsBOMItem`. Assembling increases the finished good's stock and decreases
component stock in one transaction (DocType `AS`); Stock Disassembly (`DA`) reverses it.
`Dismantled Qty` on an existing Stock Assembly is a partial reversal, not a separate
document. Requires the item to have a BOM defined first, and "Stock Assembly" to be an
enabled/licensed module.

## Supplier quoted price has a field; validity period doesn't

Request Quotation (`RequestQuotation.cs`, DocType `RQ`) has a `Unit Price` field per line
— confirmed in both source and the official wiki procedure — but no validity/expiry
date field anywhere on the document. `ExpiryTimeStamp` (seen in `RequestQuotationGrid.cs`)
is the document-*approval-workflow* expiry (a draft auto-expiring if not approved), not a
"this quoted price is valid until X" business field — easy to confuse the two. Both
`RQ` and `RQDTL` support User Defined Fields (`LayoutControlUDFUtil.SetupLayoutItems`),
so a custom "Quote Valid Until" date UDF is the standard way to add this without any
custom development.
