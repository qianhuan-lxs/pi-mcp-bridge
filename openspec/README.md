# OpenSpec

This directory holds the spec-driven development artifacts for `pi-mcp-bridge`.

OpenSpec is a lightweight, brownfield-first SDD framework. We use it to:

- **Agree before we build** — every milestone starts with a change proposal
  (`proposal.md`, `design.md`, `tasks.md`, delta `specs/`) that the maintainer
  reviews before any code is written.
- **Keep a living source of truth** — `openspec/specs/<domain>/spec.md`
  captures the current behavior contract of the system.
- **Track deltas, not rewrites** — each change describes only what it
  `ADDED`, `MODIFIED`, or `REMOVED` relative to the source of truth. On
  archive, deltas merge back into the main spec.

## Layout

```
openspec/
├── README.md                      ← you are here
├── project.md                     ← project context, principles, non-goals
├── specs/                         ← source of truth (current behavior contracts)
│   ├── mcp-bridge/
│   │   └── spec.md
│   ├── wrapper-tools/
│   │   └── spec.md
│   ├── config-registry/
│   │   └── spec.md
│   └── context-injection/
│       └── spec.md
└── changes/                       ← in-flight change proposals
    ├── phase-1-core/
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   └── specs/                  ← delta specs (ADDED / MODIFIED / REMOVED)
    ├── phase-2-oauth/
    │   └── proposal.md            ← future milestone, proposal only
    ├── phase-3-sampling/
    │   └── proposal.md
    └── phase-4-elicitation/
        └── proposal.md
```

## Workflow

We follow the standard OpenSpec loop:

```
/opsx:explore → /opsx:propose → /opsx:apply → /opsx:verify → /opsx:archive
```

- **explore** — investigate problems or clarify requirements before committing
  to a change.
- **propose** — create a change scaffold (`proposal.md`, `specs/`, `design.md`,
  `tasks.md`).
- **apply** — implement the tasks, updating artifacts as needed.
- **verify** — validate the implementation against the artifacts.
- **archive** — merge delta specs into `openspec/specs/` and finalize the
  change with a date prefix.

## Milestones

| Milestone | OpenSpec change            | Status        | Scope                                            |
|-----------|----------------------------|---------------|--------------------------------------------------|
| M0        | (bootstrap)                | ✅ Complete   | Repo, package.json, tsconfig, LICENSE           |
| M1        | (specs only)               | 🚧 In progress | Behavior contracts under `openspec/specs/`      |
| M2        | `phase-1-core`            | ⏳ Pending     | Change proposal for Phase 1                      |
| M3–M6     | `phase-1-core` (apply)     | ⏳ Pending     | Port core, registry, wrapper tools, UI           |
| M7        | (docs)                     | ⏳ Pending     | Bilingual README + architecture docs             |
| M8        | (tests + CI)               | ⏳ Pending     | Vitest + GitHub Actions                          |
| M9        | `phase-2-oauth` et al.     | ⏳ Pending     | Future phase proposals (proposal only)           |

See `openspec/project.md` for the full project context and principles.
