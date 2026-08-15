---
name: autocount-internals
description: Navigate decompiled C# source for AutoCount ERP (Accounting, POS, Server/services) AND the official AutoCount Wiki (wiki.autocountsoft.com) to answer "how does AutoCount do X", "where is Y implemented", "trace the flow of Z" questions, explain an AutoCount error message, or find documented troubleshooting/config steps. Use this whenever the user asks about AutoCount's internal behavior, business logic, data flow, a specific AutoCount module (GL, ARAP, GST, EInvoice, Stock, POS payment/promotion/eWallet, the AutoCountServerService/CostingService Windows services, etc.), or wants to find where some AutoCount feature, bug, or calculation lives in code — even if they don't say "decompiled" or "source code" explicitly, and even if they just paste an AutoCount error message, class name, or SQL migration filename and ask what it means.
---

# AutoCount Internals

Decompiled C# source for AutoCount ERP products (Accounting, POS, and the AutoCount
Server Windows services), regenerated from *your own* local AutoCount installation —
nobody hands this source between machines; every teammate produces their own copy from
their own licensed install. See [Setup](#setup-first-use-on-this-machine) below.

Default location once generated: `%LOCALAPPDATA%\AutoCountInternals\decompiled\`, with
one top-level folder per installed product (named after that product's install folder,
e.g. `Accounting 2.2`, `POS 5.2`, `AutoCount Server` — the exact name depends on which
version is installed on this machine). `manifest.json` in that folder lists exactly what
got decompiled and how — check it if you're unsure a folder exists or where it came from.

It was produced by decompiling the installed binaries (ilspycmd; single-file .NET bundles
were extracted with sfextract first). Treat it as read-only reference material — never
try to re-decompile or "fix" it; if a class/dll you need genuinely isn't present, say so.

## Setup (first use on this machine)

If `%LOCALAPPDATA%\AutoCountInternals\decompiled\` doesn't exist yet, or is missing a
product you need, run the bundled script once against this machine's own AutoCount
install — it auto-detects installed products under `Program Files\AutoCount` and
`Program Files (x86)\AutoCount`:

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\decompile-autocount.ps1"
```

Run it from this skill's own directory (shown in your context as "Base directory for
this skill" whenever this skill triggers) — that works whether this was installed as a
standalone skill or as part of a plugin.

It installs the two small dotnet CLI tools it needs (`ilspycmd`, `sfextract`) if they're
missing, then decompiles every product it finds. Takes a few minutes; expect a few hundred
MB total (AutoCount's own code only — third-party DLLs like DevExpress are skipped by
default since decompiling those too would run into low-GB territory for no benefit). Safe
to re-run — it skips products it's already decompiled unless you pass `-Force`.

It also writes two files at the root:
- `file-index.txt` — every `.cs` filename across every decompiled product, one per line,
  tab-separated from its path. **Check this file before grepping the tree.** ilspycmd names
  each file after its primary type, so for a known class/interface/enum name this turns
  "guess a module, grep it, get nothing, guess another module" (the actual time-sink when
  searching this codebase — content search itself is fast, not knowing *where* to point it
  is what's slow) into one grep against a single small file spanning every product at once.
  Falls back to the module-map + content-grep approach below when you're searching by
  keyword/concept rather than a name, or the index has no hit.
- `modules-found.txt` — every distinct `AutoCount.*` folder name found in the output. If
  AutoCount ships a new version with a module not in [module-map.md](references/module-map.md),
  it'll show up here first — worth a quick diff-by-eye after re-running on a newer install,
  since the map is a hand-maintained snapshot that can't update itself.

**Decompiled-code caveats** — this is compiler output, not the original source, so expect:
- No comments, no original local-variable intent beyond the name itself.
- Compiler-generated names: `<PropName>k__BackingField` (an auto-property's backing field —
  just read it as `PropName`), `<>c__DisplayClass12_0` (a closure capturing locals for a
  lambda/anonymous method), `<MethodName>b__3` (the lambda body itself). Don't be thrown by
  these — trace through them the same way you would a normal nested method.
- Some UI files are huge generated `InitializeComponent()` designer code — skim past it to
  find the actual event handlers / business logic methods.

## Two sources — use both

This skill covers two different kinds of knowledge, and they answer different questions:

- **Decompiled source** (below) — what the code actually does. Use for root-cause tracing,
  "why does this calculation come out this way," internal data flow.
- **[AutoCount Wiki](references/autocount-wiki.md)** — what AutoCount documents and
  already has support answers for. Use for error messages, "how do I enable/configure X,"
  release notes, and known-issue troubleshooting — check this FIRST for anything that
  sounds like a common, already-answered symptom (an exact error message is the strongest
  signal). It's a live external site, not decompiled — read the reference file for how to
  fetch it (plain WebFetch is blocked; use the browser tool) and its category structure.

They complement each other well: the wiki tells you the supported fix, the source confirms
*why* it works, and code-only tracing without checking whether it's a known issue first
can burn a lot of turns rediscovering something already documented.

## How to answer a question (decompiled source)

1. **Check [references/known-findings.md](references/known-findings.md) first.** It's a
   running log of mechanisms already traced to source in past investigations (report
   formula quirks, exact throw sites for specific error messages, what a process does and
   doesn't touch). If the question matches something already confirmed there, you're done —
   don't re-derive it. If it's a new finding worth keeping, add it there once confirmed.
2. **Know a type name (or a good guess at one)? Grep `file-index.txt` next**, e.g.
   `grep -i StockBalance file-index.txt`. If it hits, you have the exact path already —
   skip straight to step 6. This covers most lookups: error messages usually name a class,
   and even a rough guess (`grep -i yearend`) narrows hundreds of files to a handful
   instantly. Move to the steps below only when you're searching by concept/keyword instead
   of a name, or the index comes up empty.
3. **Pick the product.** Accounting desktop app vs. POS terminal vs. backend
   Windows services are largely separate codebases with their own copy of shared logic.
   If the question doesn't make the product obvious, infer it (e.g. "GST calculation" →
   Accounting; "cash drawer" / "eWallet" / "close counter" → POS; "costing service" /
   "server monitor" → AutoCount Server) or ask.
4. **Pick the module** using the table in [references/module-map.md](references/module-map.md) —
   it lists every top-level AutoCount.* project per product with what it covers, **including
   a "known gotcha" table of code that lives somewhere other than its namespace suggests**
   (e.g. GL Ledger and Stock Balance/Card actually live in `AutoCount.Accounting.UI`, not
   `AutoCount.GL`/`AutoCount.Stock`) — check that table before assuming file-index came up
   empty because the feature doesn't exist. Don't skip this step: with 163 project folders
   in Accounting alone, guessing by grep-everything wastes a lot of turns a 30-second table
   lookup avoids.
5. **Decode what you find using the glossaries**: [references/doctype-glossary.md](references/doctype-glossary.md)
   for the 2-3 letter `DocType` codes that saturate every SQL string (`IV`, `RQ`, `SA`, `PI`...),
   and [references/table-glossary.md](references/table-glossary.md) for what the recurring
   table names (`StockDTL`, `GLDTL`, `ItemPrice`, `IPHIST`...) actually hold. Both are
   confirmed-from-source, not guessed — extend them when a new one gets confirmed.
6. **Search narrow, then widen.** Grep for the class/method/keyword inside the chosen
   module folder first. Only broaden to the whole product, then to another product, if the
   narrow search comes up empty — a term like "Invoice" or "Tax" will otherwise return
   hundreds of hits across unrelated modules.
7. **Read only the matched files**, not whole folders. These projects are large; pulling a
   whole module into context defeats the point of searching first.
8. **Skip vendor code.** Folders like `DevExpress.*`, `CefSharp*`, `Grpc.*`,
   `Microsoft.*`, `System.*`, `Google.*`, `MailKit`, `BouncyCastle.Crypto` are third-party
   dependencies bundled alongside AutoCount's own code, not AutoCount's implementation —
   only search into them if you're specifically chasing a vendor API's behavior.
9. **POS and Server namespaces are folders, not separate assemblies** — e.g. (paths
   relative to `%LOCALAPPDATA%\AutoCountInternals\decompiled\`)
   `POS 5.2\AutoCount.POS.FrontEnd\AutoCount\POS\EInvoice\` or
   `AutoCount Server\AutoCountServerMonitor\AutoCountServer\` — Grep/Glob those subtrees
   directly rather than treating each product as one flat blob.

If the user's question spans product boundaries (e.g. "how does a POS sale post to GL"),
search POS for the posting/sync call first (it's the caller), then follow the trail into
whichever server/Accounting module it hands off to.
