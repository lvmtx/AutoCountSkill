---
name: autocount-internals
description: Navigate decompiled C# source for AutoCount ERP (Accounting, POS, Server/services) to answer "how does AutoCount do X", "where is Y implemented", "trace the flow of Z" questions. Use this whenever the user asks about AutoCount's internal behavior, business logic, data flow, a specific AutoCount module (GL, ARAP, GST, EInvoice, Stock, POS payment/promotion/eWallet, the AutoCountServerService/CostingService Windows services, etc.), or wants to find where some AutoCount feature, bug, or calculation lives in code — even if they don't say "decompiled" or "source code" explicitly, and even if they just paste an AutoCount error message, class name, or SQL migration filename and ask what it means.
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

**Decompiled-code caveats** — this is compiler output, not the original source, so expect:
- No comments, no original local-variable intent beyond the name itself.
- Compiler-generated names: `<PropName>k__BackingField` (an auto-property's backing field —
  just read it as `PropName`), `<>c__DisplayClass12_0` (a closure capturing locals for a
  lambda/anonymous method), `<MethodName>b__3` (the lambda body itself). Don't be thrown by
  these — trace through them the same way you would a normal nested method.
- Some UI files are huge generated `InitializeComponent()` designer code — skim past it to
  find the actual event handlers / business logic methods.

## How to answer a question

1. **Pick the product first.** Accounting desktop app vs. POS terminal vs. backend
   Windows services are largely separate codebases with their own copy of shared logic.
   If the question doesn't make the product obvious, infer it (e.g. "GST calculation" →
   Accounting; "cash drawer" / "eWallet" / "close counter" → POS; "costing service" /
   "server monitor" → AutoCount Server) or ask.
2. **Pick the module** using the table in [references/module-map.md](references/module-map.md) —
   it lists every top-level AutoCount.* project per product with what it covers. Don't skip
   this: with 163 project folders in Accounting alone, guessing by grep-everything wastes a
   lot of turns that a 30-second table lookup avoids.
3. **Search narrow, then widen.** Grep for the class/method/keyword inside the chosen
   module folder first. Only broaden to the whole product, then to another product, if the
   narrow search comes up empty — a term like "Invoice" or "Tax" will otherwise return
   hundreds of hits across unrelated modules.
4. **Read only the matched files**, not whole folders. These projects are large; pulling a
   whole module into context defeats the point of searching first.
5. **Skip vendor code.** Folders like `DevExpress.*`, `CefSharp*`, `Grpc.*`,
   `Microsoft.*`, `System.*`, `Google.*`, `MailKit`, `BouncyCastle.Crypto` are third-party
   dependencies bundled alongside AutoCount's own code, not AutoCount's implementation —
   only search into them if you're specifically chasing a vendor API's behavior.
6. **POS and Server namespaces are folders, not separate assemblies** — e.g. (paths
   relative to `%LOCALAPPDATA%\AutoCountInternals\decompiled\`)
   `POS 5.2\AutoCount.POS.FrontEnd\AutoCount\POS\EInvoice\` or
   `AutoCount Server\AutoCountServerMonitor\AutoCountServer\` — Grep/Glob those subtrees
   directly rather than treating each product as one flat blob.

If the user's question spans product boundaries (e.g. "how does a POS sale post to GL"),
search POS for the posting/sync call first (it's the caller), then follow the trail into
whichever server/Accounting module it hands off to.
