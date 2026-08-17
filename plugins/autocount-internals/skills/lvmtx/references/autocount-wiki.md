# AutoCount Wiki (official documentation)

https://wiki.autocountsoft.com — AutoCount's own MediaWiki resource center. Covers
documented/intended behavior, official troubleshooting steps, release notes, and FAQs —
things the decompiled source can't tell you, since source shows *what the code does*,
not *what it's supposed to do* or *what support already knows about this exact symptom*.

**Use the wiki first when the question is**: an error message the user is seeing, "how do
I configure/enable X," "what changed in version Y," or anything that sounds like a known,
already-documented issue. **Use the decompiled source when the question is**: why
something behaves a specific way internally, tracing a calculation/root cause, or the wiki
doesn't have an answer.

They complement each other — e.g. the wiki's FAQ literally has an article titled "Unable
to approve violet Credit Limit - Please enable Approval in Documents" for the exact error
`InvoicingDocument.Approve()` throws from `BaseStringId.ErrorPleaseEnableApprovalInDocuments`
(see [module-map.md](module-map.md)). Check both when you can — the wiki gives you the
supported fix, the source confirms why it works.

**Fetching pages**: plain `WebFetch` returns HTTP 403 on this site. Use the Claude Browser
tool (`preview_start` + `navigate` + `get_page_text`) instead — that works fine.

**Search**: the wiki's own search box works well for a direct symptom/error-message
lookup — navigate to `https://wiki.autocountsoft.com/index.php?search=<query>` (URL-encode
the query) rather than guessing an exact page title.

## Structure

Everything sits under `Category:Users:*`. The three that matter for the products in this
skill's decompiled tree:

### Category:Users:MFAQ — e-Invoice (most actively maintained; Malaysia MyInvois mandate)
- **Application** FAQs: consolidated e-Invoice, self-billed e-Invoice, backdated invoice
  submission, Tax Entity / TIN maintenance, classification codes, QR codes on receipts.
  "MyInvois Portal General Guide" and "Accounting 2.2 vs e-Invoice Illustrative Guide" are
  the two big reference guides.
- **Troubleshooting** FAQs: one article per known error message — Client ID/Secret expiry,
  TIN validation errors, "Document consist item that must generate e-Invoice, does not
  allow Consolidated e-Invoice," LHDN login errors, 403 submission errors, etc. **If a user
  pastes an exact AutoCount error message, check here first** — many are covered verbatim.

### Category:Users:Accounting — desktop Accounting app (matches `Accounting_2.2.29.41/`)
Organized by version. Full page list under "AutoCount Accounting 2.0 & 2.1 & 2.2" (the
version matching this skill's decompiled tree): *What's New*, *Help File* (the full user
manual), *FAQ (Application)*, *FAQ (Troubleshoot)*, *Others*, and per-version *Release
Note* pages (2.0/2.1/2.2). A separate "AutoCount Accounting 1.8 / 1.9 / 2.0" section has
its own FAQ/Release Note pages — those are for the *older* codebase, skip them. There's
also a specific "AutoCount Payroll" and "AutoCount POS" cross-link visible from this
category page but those live under their own categories below.

### Category:Users:POS — POS/FnB (matches `POS 5.2/`)
Full page list, organized by product line: *AutoCount Pos 5.0/5.1 & FnB 5.0/5.1 FAQ*
(shared + per-product Application/Troubleshoot pairs for Pos 5.0, FnB 5.0, OneSales Pos,
Optical Pos 2.1, QR Ordering, PalmPos), *AutoCount POS 3.1* (own FAQ pair — older, likely
doesn't match this tree), Release Notes per version/product (Pos 3.1/5.0/5.1/5.2, FnB
5.0/5.1/5.2, FnB eWaiter, FnB QR Ordering, Optical Pos 2.1/2.2), and under "Others": *AutoCount
FnB Help File*, *AutoCount Pos 5.0 Help File*, *AutoCount Pos Mall Integration Lists*,
*AutoCount Pos Payment Gateway*, *AutoCount Pos Hardware Compatibility Lists*. Also:
*AutoCount POS API*, *POS 5.2 Application Script Template* — check these before treating
something as undocumented custom behavior.

### Specific pages confirmed useful during real investigations (go straight there, skip search)
- `Request_Quotation` — full field-by-field Request Quotation entry guide.
- `Restore` — backup-file restore procedure (what "restore a backup" actually involves:
  creates a new standalone account book, doesn't merge into the live one).
- `Stock_Assembly_%26_Disassembly` — Stock Assembly Order, Stock Assembly, BOM Optional,
  Dismantled Qty, Stock Disassembly, BOM Listing Report, BOM Material Usage Inquiry — the
  full assemble/disassemble feature set in one page.
- `Accounting_2.0_-_How_to_do_Year_end_Closing_in_Version_2.0_or_above` — the official
  Year End Closing procedure, including the "backup first" step and what survives after.

### AutoCount Accounting Plug-In — directory of existing plugins
`https://wiki.autocountsoft.com/wiki/AutoCount_Accounting_Plug-In` lists AutoCount's own
catalog of accounting plug-ins (Inventory Physical Adjustment, Asset Register, ARAP Batch
Knock-Off, Item Matrix, Excel Import Management, Barcode, Recurring Billing, and more) —
useful prior art for naming conventions, scope, and typical feature-set when building a
new plug-in, even where the individual page has no content of its own.

### Not covered by this skill's decompiled tree
- **AutoCount HRMS** — separate product, separate help site (`help.hrms.autocountcloud.com`),
  not a MediaWiki category, not decompiled here.
- **AutoCount On The Go (AOTG)** — `Category:Users:AOTG`, not decompiled here.
