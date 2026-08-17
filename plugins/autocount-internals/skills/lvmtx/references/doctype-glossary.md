# AutoCount DocType Code Glossary

Every AutoCount document is identified by a 2-character (occasionally different-length)
`DocType` code, used constantly in raw SQL throughout the source (`WHERE DocType IN
('IV','CN','DN')`, `DocumentStatusHelper.EnableApprovalInDocuments(dbSetting, "IV")`, etc.).
Source of truth: [`DocumentType.cs`](../../../Accounting_2.2.29.41/AutoCount.Accounting/AutoCount.Document/DocumentType.cs)
in the core `AutoCount` library — this table is transcribed directly from its
`RegisterDefaultDocumentType()` method, so it's authoritative for this AutoCount version,
not inferred. Grep that file directly if a code you need isn't listed below (rare —
this covers the full registered set as of Accounting 2.2.29.41).

| Code | Document | Category |
|---|---|---|
| `OB` | Opening Balance | — |
| `AQ` | Advanced Quotation | Sales |
| `QT` | Quotation | Sales |
| `SO` | Sales Order | Sales |
| `DO` | Delivery Order | Sales |
| `IV` | Invoice | Sales |
| `CS` | Cash Sale | Sales |
| `CN` | Credit Note | Sales |
| `DN` | Debit Note | Sales |
| `XS` | Cancel Sales Order | Sales |
| `DR` | Delivery Return | Sales |
| `CG` | Consignment | Sales |
| `CR` | Consignment Return | Sales |
| `BN` | A/R Billing Note | Sales |
| `OS` | Point of Sale | — |
| `CI` | Consolidated e-Invoice | e-Invoice |
| `AT` | Aggregated Transaction | SG e-Invoice |
| `SB` | Self-Billed (e-Invoice) | e-Invoice |
| `BR` | Bonus Point Redemption | Others |
| `PA` | Bonus Point Adjustment | Others |
| `GI` | Gift Rule | Others |
| `S#` | Serial Number Format | Others |
| `PQ` | Purchase Request | Purchase |
| `RQ` | Request Quotation (RFQ) | Purchase |
| `PO` | Purchase Order | Purchase |
| `GR` | Goods Received Note | Purchase |
| `PI` | Purchase Invoice | Purchase |
| `CP` | Cash Purchase | Purchase |
| `PR` | Purchase Return | Purchase |
| `XP` | Cancel Purchase Order | Purchase |
| `GT` | Goods Return | Purchase |
| `PG` | Purchase Consignment | Purchase |
| `SG` | (obsolete — use `PG`) Supplier Consignment | Purchase |
| `NR` | Purchase Consignment Return | Purchase |
| `ST` | Stock Transfer | Stock |
| `SK` | Stock Take | Stock |
| `SA` | Stock Adjustment | Stock |
| `SI` | Stock Issue | Stock |
| `SR` | Stock Receive | Stock |
| `WO` | Stock Write Off | Stock |
| `UC` | Stock UOM Conversion | Stock |
| `UT` | Stock Update Cost (recalculate-cost engine writes) | Stock |
| `AS` | Stock Assembly | Manufacturing |
| `AO` | Stock Assembly Order | Manufacturing |
| `DA` | Stock Disassembly | Manufacturing |
| `CB` | Cash Book | GL |
| `OR` | Cash Receipt | GL |
| `PV` | Cash Payment | GL |
| `JE` | Journal Entry | GL |
| `KS` | Bank Slip | GL |
| `CT` | A/R and A/P Contra | — |
| `RS` | A/R Deposit | — |
| `RT` | A/R Deposit Forfeit | — |
| `RU` | A/R Deposit Refund | — |
| `PS` | A/P Deposit | — |
| `PT` | A/P Deposit Forfeit | — |
| `PU` | A/P Deposit Refund | — |
| `RI` | A/R Invoice | — |
| `RD` | A/R Debit Note | — |
| `RC` | A/R Credit Note | — |
| `RF` | A/R Refund | — |
| `RP` | A/R Payment | — |
| `PB` | A/P Invoice | — |
| `PD` | A/P Debit Note | — |
| `PC` | A/P Credit Note | — |
| `PF` | A/P Refund | — |
| `PP` | A/P Payment | — |
| `MP` | Shop Order | — |
| `MR` | Shop Return | — |
| `D2` | Debtor (master record, used as a pseudo-doctype in some contexts) | — |
| `C2` | Creditor (same) | — |
| `I1` | Item (same) | — |
| `FR` | Foreign Currency Revalue | — |
| `UR` | Unrealized Gain/Loss | — |
| `K1`–`K8` | Knock-off transactions (AR CN/Payment/Refund/Contra, AP CN/Payment/Refund/Contra) — see `DocumentType.cs` for the exact K-number-to-type mapping | — |
| `S1` | Security | — |
| `SS` | System | — |
| `P9` | Plug-Ins | — |
| `BS` | Sales Order Processing (workflow) | — |
| `BA` | Assembly Order Processing (workflow) | — |
| `R1`–`R4` | Purchase/Delivery/AssemblyOrder/Assembly Request Processing (workflow variants) | — |

Note the near-mirror pairs: `RI`/`RD`/`RC`/`RF`/`RP` (A/R side) vs `PB`/`PD`/`PC`/`PF`/`PP`
(A/P side) — same transaction shape, opposite side of the ledger. Easy to mix up when
skimming SQL; the code's first letter is the tell (`R` = receivable, `P` = payable),
except `PI`/`PO`/`PR`/`PG` which are the actual purchase *documents* (Purchase Invoice/
Order/Return/Consignment), not A/P transactions.
