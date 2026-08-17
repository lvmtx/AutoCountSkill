# AutoCount Module Map

One-liners are inferred from folder/namespace names, not verified against docs — treat
them as a starting hypothesis for where to look, not ground truth.

## AutoCount Server (`AutoCount Server/`)

Backend Windows services. Most of these exes are single-file bundles, so
`decompile-autocount.ps1` extracts each one's own copy of its dependencies into a
subfolder named after that exe — e.g. `AutoCountServerService\AutoCountServer\...` and
`AutoCountCostingService\AutoCount\...`. The same shared libraries (`AutoCount`,
`AutoCountServer`) end up duplicated under each exe that bundles them; that's expected,
not a mistake — pick whichever copy sits under the exe you're already looking at.

| Exe folder | Covers | Bundled libs found inside |
|---|---|---|
| `AutoCountServerService` | The Windows service host itself | `AutoCountServerService`, `AutoCountServer` |
| `AutoCountServerMonitor` | Tray/monitor app that watches AutoCountServerService | `AutoCountServerMonitor`, `AutoCountServer` |
| `AutoCountCostingService` | Standalone costing calculation service (ASP.NET Core, gRPC/SignalR) | `AutoCountCostingService`, `AutoCount`, `AutoCountCostingService.Shared` |
| `AutoCountCostingServiceMonitor` | Monitor app for the costing service | `AutoCountCostingServiceMonitor`, `AutoCountCostingService.Shared` |
| `AutoCountServerInstaller` | Plain WinForms installer (not a bundle, decompiled directly) | itself only |

`AutoCountServer` = main server-side library the services host (largest, ~1000+ files).
`AutoCount` = shared core library also used by Accounting (data access, business objects).

## AutoCount POS 5.2 (`POS 5.2/AutoCount.POS.FrontEnd/AutoCount/`)

Single assembly (`AutoCount.POS.FrontEnd`); organized by namespace folder under `POS/`
(plus tiny `POSUDF/`, `UDFPOS/` for user-defined-field support):

| Folder | Covers |
|---|---|
| `POS/FrontEnd` | Main POS UI shell; subfolders `IPay88_Request(ry|Void)` (IPay88 payment gateway calls), `LicenseService`, `DialogForms`, `FilterUI` |
| `POS/PaymentForms`, `PaymentForms/eWallet` | Payment entry screens incl. e-wallet payments |
| `POS/PaymentGateway/Euronet` | Euronet payment gateway integration |
| `POS/Device` | Hardware integration (receipt printer, cash drawer, scanner, customer display) |
| `POS/Integration/Sunmi` | Sunmi POS terminal hardware integration |
| `POS/CloseCounter` | End-of-day counter closing / cash-up |
| `POS/BIRDiscount` | Philippines BIR (tax authority) senior citizen/PWD discount rules |
| `POS/EInvoice` | e-Invoice submission from POS |
| `POS/License` | POS license/activation checks |
| `POS/Maintenance`, `POS/MemberMaintenance`, `Maintenance/Member` | Member/loyalty master-data maintenance |
| `POS/Promotion` | Promotions/discount rule engine |
| `POS/Restaurant`, `Restaurant/PrinterSetMaintenance` | Restaurant mode (table service, kitchen printer routing) |
| `POS/Scripting`, `Scripting/UI` | Custom scripting/macro support |
| `POS/StaffAttendance` | Staff clock-in/attendance |
| `POS/Model` | Shared data model classes |
| `POS/Controls`, `POS/DialogForms`, `POS/FilterUI` | Shared UI controls/dialogs |
| `POS/UDF`, `POSUDF/`, `UDFPOS/` | User-defined fields |

Top-level `.SQL` files (outside any folder, e.g. `AutoCount.POS.FrontEnd.SQL.POS-1.82.SQL`,
`...BSP.bsp_Change*.SQL`) are embedded DB migration scripts — useful for tracing schema
history/version of a specific column or table by number.

## AutoCount Accounting (`Accounting 2.2/` — exact folder name matches whatever version is installed)

~163 top-level assembly folders (one per DLL in the install directory). AutoCount's own code is every `AutoCount.*` /
`AutoCount` folder; everything else (`DevExpress.*`, `CefSharp*`, `Grpc.*`,
`Microsoft.*`, `System.*`, `Google.*`, `MailKit`, `BouncyCastle.Crypto`, `Flee`,
`PhoneNumbers`, `WindowsInput`, `zxing`, `Daxonet.*`) is a third-party dependency — skip
unless you're specifically chasing vendor-library behavior.

### Known gotcha: code that lives somewhere other than its namespace suggests

`AutoCount.Accounting.UI` isn't just accounting UI — it's where a lot of OTHER modules'
actual report/business logic lives too, confirmed by scanning every subfolder inside it
and cross-referencing against top-level assembly names:

| Namespace inside `AutoCount.Accounting.UI` | You'd expect it in... | Files |
|---|---|---|
| `AutoCount.Stock.StockBalance`, `StockCard`, `StockLevel`, `StockStatus`, `Item` | `AutoCount.Stock` | 46 |
| `AutoCount.GL.Ledger`, `CashBook`, `JournalEntry`, `AccountBalanceInquiry`, `BankBook2`, `BankBookAnalysis2` | `AutoCount.GL` | 29 |
| `AutoCount.Invoicing.PriceHistory` | `AutoCount.Invoicing` | 21 |
| `AutoCount.Inquiry.UserControls` | `AutoCount.Inquiry` | 14 |
| `AutoCount.ARAP.CreditorAging`, `CreditorBalance`, `DebtorAging`, `DebtorBalance` | `AutoCount.ARAP` | 8 |

**Practical rule: if `file-index.txt` shows a class living under `AutoCount.Accounting.UI`
when you expected `AutoCount.GL`/`AutoCount.Stock`/`AutoCount.ARAP`/`AutoCount.Invoicing`/
`AutoCount.Inquiry`, that's not a mistake in the index — that's just where AutoCount
actually compiled it.** This was found by scanning every subfolder in `AutoCount.Accounting.UI`
against the list of top-level assembly names — if a similar mismatch shows up in a
different module while investigating something, add it to this table.

| Folder | Covers |
|---|---|
| `AutoCount` | Shared core library (data access, business objects, framework) — same lib used by AutoCount Server |
| `AutoCount.Accounting` | Main accounting business logic |
| `AutoCount.Accounting.UI` | WinForms UI for the accounting module — **also where a lot of cross-cutting report/inquiry logic actually lives**, not just UI: GL Ledger (`AutoCount.GL.Ledger`), Stock Balance and Stock Card (`AutoCount.Stock.StockBalance`/`StockCard`) are all here, not in `AutoCount.GL` or `AutoCount.Stock` despite the namespace names. If a report class isn't where its namespace suggests, check here before widening the search. |
| `AutoCount.ARAP` | Accounts Receivable / Accounts Payable |
| `AutoCount.BI` | Business intelligence / dashboards |
| `AutoCount.BusinessFlow` | Workflow / approval flow engine |
| `AutoCount.DataUpgrade` | Database schema migration / version upgrade logic |
| `AutoCount.EInvoice` | e-Invoice (Malaysia MyInvois) integration |
| `AutoCount.EInvoice.Singapore` | Singapore InvoiceNow e-invoice variant |
| `AutoCount.FinancialReport` | Financial statement / report generation |
| `AutoCount.GL` | General Ledger |
| `AutoCount.GST` | GST/SST tax module |
| `AutoCount.GeneralMaint` | General master-data maintenance screens |
| `AutoCount.Image100p` … `Image500p`, `AutoCount.Images` | DPI-scaled icon/image resource sets (100%–500%) — rarely relevant to logic questions |
| `AutoCount.ImportExport` | Data import/export |
| `AutoCount.Inquiry` | Inquiry / drill-down reporting screens |
| `AutoCount.Invoicing` | Sales invoicing |
| `AutoCount.MainEntry`, `AutoCount.MainEntry.XmlSerializers` | Main application shell / entry point |
| `AutoCount.ManageAccountBook` | Account book (company database) management |
| `AutoCount.ManagementStudio` | Admin/management studio tool |
| `AutoCount.Manufacturing` | Manufacturing / bill-of-materials module |
| `AutoCount.Purchase` | Purchasing module |
| `AutoCount.Sales` | Sales module |
| `AutoCount.StartScreen` | Startup splash/launcher screen |
| `AutoCount.Stock` | Inventory/stock module |
| `AutoCount.StockMaint` | Stock maintenance screens |
| `AutoCount.Tax.Philippines` | Philippines-specific tax (BIR) logic |
| `AutoCount.Tools` | Misc utility tools |
| `AutoCount.UI`, `AutoCount.UI.XmlSerializers` | Shared UI framework/controls used across modules |

Note: `AutoCount.Accounting` and `AutoCount.ARAP`/`AutoCount.GL`/etc. are separate assemblies
even though conceptually ARAP/GL are "part of accounting" — search the specific module
folder for the specific ledger/document type, and fall back to `AutoCount.Accounting` or
the shared `AutoCount` folder for cross-cutting logic.
