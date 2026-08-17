# AutoCount Internals Plugin

Install as: `lvmtx@AutoCountSkill` (plugin name `lvmtx`, from the `AutoCountSkill`
marketplace — see the repo root for the exact `/plugin marketplace add` / `/plugin install`
commands). "AutoCount Internals" here is a description, not the literal install name.

Lets Claude navigate AutoCount ERP's decompiled source (Accounting, POS, Server) and the
official [AutoCount Wiki](https://wiki.autocountsoft.com) to answer questions about how
AutoCount actually works internally, trace the root cause of a bug, or find a documented
fix for an error message.

## What It Does

Claude automatically uses this skill when you ask about AutoCount's internal behavior —
a specific module (GL, ARAP, GST, EInvoice, Stock, POS payment/eWallet, the server/costing
services), a calculation that looks wrong, or an exact error message. It knows which of
AutoCount's own assemblies per product covers what, so it searches the right file directly
instead of guessing across hundreds of files.

## Usage

```
"why does Stock Balance show a different quantity than Stock Card for this item"
"I get 'Please enable Approval in Documents' when saving an invoice, why"
"where does AutoCount POS decide which e-wallet payment gateway to use"
```

## Setup (once per machine)

The plugin ships the navigation logic only — not AutoCount's source. Each person
regenerates their own decompiled copy from their own licensed AutoCount install:

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\decompile-autocount.ps1"
```

Run from the skill's own directory. Takes a few minutes, a few hundred MB, safe to re-run.
See `skills/lvmtx/SKILL.md` for details.

## Authors

Daxonet
