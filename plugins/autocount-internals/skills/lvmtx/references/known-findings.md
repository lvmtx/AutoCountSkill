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

## Azure SQL Database and Managed Instance are not supported hosting targets for AutoCount

`DBSql.cs` (`AutoCount.Data.Sql`) has a dedicated branch for hostnames ending in
`.database.windows.net`, building a proper Azure-style connection string
(`server=tcp:...;encrypt=true`) — so basic connectivity genuinely works, and login
against an already-populated Azure SQL Database/Managed Instance can succeed. But
several *other* code paths assume a real, file-system-backed SQL Server instance and
break on true PaaS:

- **No restore.** The Restore Wizard (`BackupRestoreHelper.cs`) issues raw
  `RESTORE DATABASE ... FROM DISK`, which Azure SQL Database's engine rejects outright
  (`Msg 40510`, "not supported in this version of SQL Server"). Managed Instance
  supports `RESTORE DATABASE ... FROM URL` (blob storage) instead, but not `FROM DISK`.
- **`CREATE DATABASE` only works with no explicit file path.** `DBUtilsSQL.cs`'s
  `CreateDatabase()` adds `FILENAME=...`/`FILEGROWTH=...` clauses whenever a
  `dbFileName` is supplied — invalid on Azure SQL Database, which has no addressable
  file system. A "Create New Account Book" with no file path specified takes the plain
  `CREATE DATABASE [name] COLLATE ...` branch instead, which *is* Azure-compatible.
- **`AutoCount Database Setup` needs `master` access** to create/attach/detach/drop
  company databases — Azure SQL Database is scoped to one database and never grants
  this (confirmed independently in Daxonet's own AutoCount-on-Azure proposal doc, not
  just from source).
- **Multi-company relies on cross-database queries** — unsupported on Azure SQL
  Database.
- Several maintenance/upgrade routines assume a sysadmin-equivalent login, which the
  PaaS tier never exposes.

The supported path (also Daxonet's own recommended architecture) is AutoCount + a real
SQL Server instance (Express/Standard) co-located on the same VM/machine — never split
across a network, and never against Azure SQL Database/Managed Instance directly.

## The Attach Account Book "Get Available Databases" button always tries login `sa`

`FormAttachAccountBook.sbtnGetDatabases_Click` calls
`new FormAvailableSQLDatabase(serverName, saPassword)` — only two arguments.
`FormAvailableSQLDatabase`'s constructor signature is
`(string serverName, string saPassword, string userID = "sa")`, so the third parameter
silently defaults to `"sa"` regardless of whatever custom username was typed into the
form's own User Name field. Works fine against a real SQL Server where `sa` is the
actual login; fails with "incorrect login" against anything using a different admin
account (e.g. Azure SQL Database's `dbadmin`) even when the credentials you typed are
correct. Workaround: skip that browse button, type the database name directly.

## `dbo.REGISTRY` (RegID 24) gates a post-login AutoCount Server sync call

`ApplicationVersion` (`AutoCount.RegistryID`) is `RegID = 24`, read/written via
`DBRegistrySQL.GetValue`/`SetValue` against `SELECT/UPDATE ... FROM REGISTRY WHERE
RegID=...`. `FormLoginAccountBook.CheckApplicationVersion()` compares this stored value
against the client's own hardcoded version string; if the stored value is *newer*, it
calls `CommonServiceHelper.CheckServerConnection()` (a gRPC call to AutoCount Server,
port 19500 by default, `DEADLINE_SECONDS = 30` hardcoded, not configurable). A
migrated/restored account book carries whatever `ApplicationVersion` the *original*
environment had, which can trigger this unconditionally on first login elsewhere.
Separately, `MainFormJobsHelper.CheckAutoCountServerVersion()` makes an *unconditional*
version of the same call on every login regardless of the REGISTRY value — this is the
more likely source of a `DeadlineExceeded` popup that appears right after every login,
not just once.

**Investigated but not conclusively resolved**: chasing a `DeadlineExceeded` from this
call against Azure SQL Database, we found `AccountBookHelper.TestDBConnection`
(AutoCount Server side, `AutoCount.Shared.Helper`) calls
`SERVERPROPERTY('productlevel')` and `.ToString()`s the result with no null check,
inside a bare `catch { result = false; }` that logs nothing — a real bug if that
property is ever `NULL`. It was *not* the actual cause in the case we traced (a live
`SELECT SERVERPROPERTY('productlevel')` against the specific Azure SQL Database in
question returned `"RTM"`, not `NULL`), so don't assume this is the explanation without
checking that property directly against the database in question first. The genuine
root cause of that specific timeout was never pinned down (live SQL session monitoring
showed the connection succeed and sit idle, ruling out a slow/blocked query) — but the
practical finding was that the error is dismissible and doesn't block actual use; login
and core database functionality work fine even when this popup fires.

## POS Full Sync vs Speed Sync — different scope, not different data

Per AutoCount's own wiki ("Speed Sync vs Full Sync?"): Speed Sync only pushes records
changed since the last sync (tracked via a `ChangeLog` table) and is what runs on the
regular auto-sync timer (default 15 min, adjustable down to 5). Full Sync
unconditionally overwrites all master data in both directions regardless of whether
anything changed, and explicitly does *not* consult ChangeLog — the wiki warns against
running it right after item codes were changed/merged elsewhere, since it can clobber
that in-progress state. Transactions sync back to backend via *both* mechanisms, not
exclusively via Full Sync — that's why transactions can still show up between
scheduled Full Sync runs.

## POS A/B has two sync transports — LocalNetwork isn't the only option

`HttpClientSyncObject` (`AutoCount.POS.ClientSync`) picks its sync URL based on
`TerminalProfile.SyncType`, an enum with exactly two values:
`TerminalSyncType.LocalNetwork` (`http://{SyncIPAddress}:{SyncPort}` — a plain HTTP call,
not a broadcast/discovery protocol, so it's not inherently LAN-only; a routed VPN
connecting two private address spaces would satisfy it) and `TerminalSyncType.ServiceBus`
(`https://{ServiceBusNameSpace}.servicebus.windows.net` — Azure Service Bus Relay,
purpose-built by AutoCount for connecting POS B to POS A over the internet without VPN
or port-forwarding at all). Both are configured in the real Terminal Wizard
(`FormTerminalWizard.cs` — two actual checkboxes, "Controlled By Local Network" vs
"Controlled By Service Bus"). So POS A/B *can* span physically separate outlets, either
via VPN (LocalNetwork mode) or natively via ServiceBus mode — it doesn't hard-require
same-LAN the way the "192.168.x.x/10.x.x.x same building" wiki wording first suggests.
Caveat: this is a frequent near-real-time HTTP sync, not a periodic batch — expect real
WAN latency per call over either transport, worth piloting on one remote store first.

POS Branch remains the other option (each outlet has its own local database, syncing
back to central backend periodically via Remote HQ) — the real distinction between it
and POS A/B-over-WAN is periodic-separate-databases vs. one continuously-shared database,
not "can only be same LAN" vs. "can span locations."

**Licensing correction, important**: the `ServiceBus` transport existing in
`HttpClientSyncObject` does NOT mean any POS install can use it. AutoCount's actual
commercial product line has three distinct POS Frontend modules — **Module Branch**
(Branch Sync included), **Module A** (Branch Sync available as a paid add-on), and
**Module B** (Branch Sync **not available at all, not even as an add-on** — confirmed
via an official AutoCount reseller's product page, not just source). So a "HQ = POS A,
every store = POS B" topology can never get proper branch/multi-location sync no matter
how it's networked (VPN or ServiceBus) — Module B is licensed/gated to not support it.
The code-level finding above (ServiceBus is a real WAN-capable transport) is accurate,
but it's the mechanism behind Branch Sync specifically, which requires Module Branch or
Module A+add-on licensing — not something to assume works on a bare Module B install.

**Architecture correction, also important**: even with correct licensing, Branch Sync is
NOT one live shared database that every branch queries directly. Per AutoCount's own
product description, "the POS 5 installer separates the backend database on the server
from the frontend databases on cashier terminals to support offline operations," and
Branch Sync "keeps sales transactions, stock movements, and customer records synced
between branches and HQ in real time or scheduled intervals." Each location — HQ and
every branch — keeps its own local database; Branch Sync copies data between them rather
than one DB being queried live by all sites. This is deliberate, so each branch keeps
operating if its internet connection drops. Practical consequence: "can a customer
return an item at a different branch than they bought it" is true only *after* that
sale has synced across — not instantly by architecture alone. If cross-branch returns
need to feel reliably immediate, confirm Branch Sync is configured for real-time sync,
not a longer scheduled interval, and expect a real (if usually short) window right after
a sale where it hasn't reached other branches yet.

## "Select Type Of Stock In Transaction" (Return vs Trade In) is a standard POS feature, gated by an Option Setting

Entering a negative quantity in POS Sales (`FormSales.cs`) checks
`PosSystem.OptionSetting.TradeIn` (a real property on `AutoCount.POS.OptionSetting`,
toggled via POS Backend → Point of Sale → Maintenance → POS Option Maintenance → "Trade
In"). Off: the line silently defaults to `TypeOfStockIn = "R"` (Return), no dialog at
all. On: shows `FormSelectTypeOfStockIn` (a real native form, not a plugin) letting the
cashier choose Return vs Trade In. There's also a matching Front End Access Right
constant (`FrontEndAccessRightConst.TradeIn`) gating who can use it. Trade-in items get
distinct handling downstream: a manual cost entry via `FormEnterCost` (a traded-in item
has no normal selling price), and they're explicitly blocked from E-Invoice submission
with their own confirmation warning (`TradeInItemCannotBeRecordedAsEInvoice`).
**Lesson learned the hard way**: don't conclude "not standard, must be a plugin" from a
grep that only checked the localized UI caption text — that's pulled from a resource at
runtime and won't match a plain string search. Search for the likely class/property name
(`FormSelectTypeOfStockIn`, `OptionSetting.TradeIn`) before concluding a feature doesn't
exist in source.

## `ARPaymentEntity.KnockOff()`'s date parameter defaults to null — but it doesn't stay null

`ARPaymentEntity.KnockOff(docType, docNo, amount)` (3-arg overload) calls the 4-arg
version with `knockOffDate: null`, which sets `ARPaymentKnockOff.GainLossDate` to
`DBNull.Value` on the in-memory row. **This is not the end of the story** — it looks
like a "date is simply never captured" bug if you stop tracing here, but
`SaveARPayment()` (`ARPaymentDataAccess.cs`, `SetGainLossDate()`) runs on every save,
for every caller (desktop UI or a custom plugin calling `KnockOff()` directly), and
back-fills any still-null `GainLossDate` with the **later of** the ARPayment's own
`DocDate` or the knocked-off Invoice/DN's `DocDate` (floor-clamped to the fiscal year's
`ActualDataStartPeriod` if that would otherwise land inside a locked period). The
desktop UI's own default (`FormARCNEdit.SetDefaultKnockOffDate()` — same "later of the
two dates" logic, or `DateTime.Today` if the `myUseTodayDate` option is on) just applies
this earlier, at grid-row-select time; the save-time fallback is what actually guarantees
a date exists regardless of caller. A custom API/plugin calling the 3-arg `KnockOff()`
does **not** need to pass a date to get a sensible one — it happens automatically at
save.

**Lesson learned the hard way**: traced `KnockOff()` alone, saw it pass `null`, and
confidently told the user "it stays null, add a date field to your API" — wrong, because
the actual value only exists after the full save path runs, not at the point the
document object is mutated in memory. **Before asserting what a value ends up as, trace
all the way through the corresponding `Save*()`/data-access method, not just the
in-memory entity method that looked like the answer.** A field being null right after
one call doesn't mean it's null in the database — plenty of AutoCount save paths apply
defaults/fallbacks at persist time that never show up if you stop reading at the object
model.

## "Your license sync type is LocalSync, so you must enter IP address 127.0.0.1..." — exact trigger condition

`HttpClientSyncObject` (`AutoCount.POS.ClientSync`) constructor computes a `myIsBranchSync`
flag purely from the configured `TerminalProfile.SyncIPAddress` string: if it starts with
`192.168.`, `127.0.0.1`, `172.16.`, or `10.`, `myIsBranchSync = false`; **any other IP**
(a public IP, or a private range outside those four prefixes, e.g. `172.17.x`–`172.31.x`
which is also RFC1918 private but not covered by this check) sets `myIsBranchSync = true`.
Later, `CheckSyncLicenseAndGetParentProductID()` throws
`ClientSyncStringId.SyncTypeIsLocalSync` (the exact message quoted above) when
`myIsBranchSync && !myPosLicense.BranchSync` — i.e. the terminal's Sync IP Address falls
outside those four prefixes **and** the license's `BranchSync` entitlement is off (plain
Module A/B, no Branch add-on — see the Licensing correction above).

Two independent fixes, pick based on actual topology:
1. **Same LAN or routed VPN**: the client PC connecting to POS must reach the backend at
   a Sync IP Address inside one of the four checked prefixes. If VPN-routed, use the
   VPN-assigned address in that range, not a public one — this is a config fix, not a
   licensing issue, and is the fix when nothing has actually changed except which PC is
   connecting.
2. **Genuinely different network/public IP**: this is real Branch Sync territory by the
   code's own definition — requires Module Branch or Module A + Branch Sync add-on;
   plain Module B can never clear this check regardless of IP.

Note the resx string text itself is stale — it lists only `127.0.0.1`/`192.168.`/`10.`,
omitting `172.16.`, even though the code checks all four. Don't rely on the displayed
message alone to enumerate the accepted ranges; the source is a further prefix.

## Without a registered license, AutoCount Server defaults to 3 concurrent network users per type

`RemoteLicenseService.SessionLogin()` (`AutoCount Server\AutoCountServerService`,
`AutoCount.Service`) is the actual concurrency gatekeeper — every Accounting client login
calls this on the AutoCount Server service, which tracks active sessions in an in-memory
`Session` DataSet (Master/Detail tables) keyed by ProductID/ComputerName/UserName/SessionId.
Before checking the real license, it seeds three local defaults:
`int num5 = 3` (FullSystemNetworkUsers), `int num6 = 3` (AccountOnlyNetworkUsers),
`int num7 = 3` (StockOnlyNetworkUsers). It then tries to find a `LicenseEntity` whose
`ProductID` matches the connecting account book/product and read its real
`AccountingLicense.FullSystemNetworkUsers`/`AccountOnlyNetworkUsers`/`StockOnlyNetworkUsers` —
**only if that lookup succeeds do the real licensed numbers overwrite the defaults**. If the
account book was never registered into the license (no matching `LicenseEntity`, or its
`AccountingLicense` is null), the check silently runs against the hardcoded `3`/`3`/`3` and
throws `NetworkControllerUtilsStringId.NetworkUsersAlreadyLogined` (or the Account-only/
Stock-only variants) once total active sessions for that product exceed 3 of that type.
**Answer to "how many concurrent users without a license": 3** (per network-user type, not
a single shared pool) — this is a fallback/trial allowance baked into the server service
itself, not a documented product tier, so don't quote it to a client as an intentional trial
feature — verify against the actual behavior if AutoCount changes this in a future release.
