# RALPH Runner

RALPH (Run Autonomous Loops Per Handoff) is a VS Code extension that turns `prd.json` user stories into a context-aware execution loop for GitHub Copilot Chat. It still manages autonomous story execution, but now enriches each prompt with project constraints, per-story design context, recalled task memory, and a stricter completion contract before a story is considered done.

Use it when you want Copilot to execute a queue of implementation stories while preserving repo-specific rules, UI intent, and prior decisions across the run.

## What RALPH Does

- Runs user stories in priority order from `prd.json`
- Persists workflow state in `.ralph/` so execution is resumable
- Splits and merges PRDs into `.prd/` sidecar files for local story management
- Scans the workspace to generate machine-readable and editable project constraints
- Stores per-story design context next to split user stories
- Requires a structured task memory artifact before accepting completion
- Recalls relevant prior task memories and injects them into later prompts
- Builds prompts in a fixed order: system rules, project constraints, design context, prior work, current story, completion contract

## Requirements

- VS Code 1.109.0 or later
- GitHub Copilot Chat installed and signed in
- A workspace root containing `prd.json`

## Core Files

### `prd.json`

`prd.json` remains the execution source of truth. It defines the project metadata and the ordered user story list.

```json
{
  "project": "MyProject",
  "branchName": "ralph/feature-branch",
  "description": "Short description of the project goal",
  "userStories": [
    {
      "id": "US-001",
      "title": "Setup Project Structure",
      "description": "Create the initial project directory structure and configuration files",
      "acceptanceCriteria": [
        "Project directories exist",
        "Configuration files are created"
      ],
      "priority": 1
    }
  ]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `project` | Yes | Project name |
| `branchName` | Yes | Suggested Git branch name |
| `description` | Yes | Overall project goal |
| `userStories` | Yes | Array of executable user stories |
| `userStories[].id` | Yes | Stable story identifier such as `US-001` |
| `userStories[].title` | Yes | Short story title |
| `userStories[].description` | Yes | Task description given to Copilot |
| `userStories[].acceptanceCriteria` | Yes | Flat list of checks for the story |
| `userStories[].priority` | Yes | Lower number runs first |

### Runtime Artifacts

RALPH creates and maintains these files during the workflow:

| Path | Purpose |
| --- | --- |
| `.ralph/task-<id>-status` | Execution lock and completion signal for the active story |
| `.ralph/story-status.json` | Durable per-story workflow status used by split and merge workflows |
| `.ralph/project-constraints.generated.json` | Machine-generated summary of stack, scripts, architecture, allowed paths, and delivery checks |
| `.ralph/memory/US-xxx.json` | Structured task memory for one completed story |
| `.ralph/memory-index.json` | Compact recall index built from all persisted task memories |
| `.github/ralph/project-constraints.md` | Team-maintained editable constraint document layered over generated constraints |
| `.prd/base_prd.json` | Project metadata split out from `prd.json` |
| `.prd/user_stories/US-xxx.json` | Split user story file with local status |
| `.prd/user_stories/US-xxx.design.json` | Story-specific design context sidecar |
| `progress.txt` | Append-only execution log of done or failed outcomes |

## Context-Aware Workflow

### 1. Generate or split the PRD

Use `RALPH: Generate PRD` to create the root PRD, then optionally run `RALPH: Split PRD` to create `.prd/base_prd.json` and `.prd/user_stories/US-xxx.json` files for easier local coordination.

### 2. Initialize project constraints

Run `RALPH: Initialize Project Constraints` before executing stories that need repo-specific guidance.

The command scans the workspace for:

- `package.json` scripts and dependencies
- `tsconfig.json`
- ESLint configuration
- `README.md`
- high-level `src/` folder structure

It writes two artifacts:

- `.ralph/project-constraints.generated.json` for normalized machine-readable prompt injection
- `.github/ralph/project-constraints.md` for human-maintained overrides and rules

### 3. Record design context when a story is UI-sensitive

Run `RALPH: Record Design Context` for stories that affect layout, components, design tokens, screenshots, or visual acceptance checks.

Each design sidecar can capture:

- Figma URL
- screenshot paths
- manual notes
- layout constraints
- component reuse targets
- token rules
- responsive rules
- protected UI regions
- explicit visual acceptance checks

RALPH stores that context in `.prd/user_stories/US-xxx.design.json` and summarizes it before prompt injection.

Attach design context when a story changes any of the following:

- page layout or information hierarchy
- reusable UI components
- color, spacing, or typography tokens
- responsive behavior
- a designer-approved acceptance target

### 4. Execute or preview memory recall

Run `RALPH: Recall Related Task Memory` to preview which prior stories are likely relevant to the current work. During normal execution, RALPH can also do this automatically and inject a bounded `Relevant Prior Work` section.

Recall scoring uses:

- related or dependent story IDs
- keyword overlap
- module hints
- changed file overlap
- recency

### 5. Start autonomous execution

When you run `RALPH: Start`, RALPH composes a prompt in this fixed order:

1. System execution rules
2. Project constraints
3. Design context
4. Relevant prior work
5. Current story
6. Completion contract

The prompt remains bounded so optional context does not overwhelm the current task.

### 6. Require task memory before completion

RALPH no longer treats the completion signal as sufficient by itself. Before a story is finalized, Copilot must persist a structured task memory artifact to `.ralph/memory/US-xxx.json` with fields such as:

- `summary`
- `changedFiles`
- `changedModules`
- `keyDecisions`
- `constraintsConfirmed`
- `testsRun`
- `risks`
- `followUps`
- `searchKeywords`

If Copilot fails to write a valid artifact, RALPH synthesizes a fallback memory entry and updates `.ralph/memory-index.json` so later stories can still recall useful context.

## Commands

| Command | Description |
| --- | --- |
| `RALPH: Start` | Begin or resume the autonomous execution loop |
| `RALPH: Stop` | Cancel the current loop immediately |
| `RALPH: Show Status` | Show counts, next pending story, and current progress |
| `RALPH: Reset Story` | Reset a completed or failed story for re-execution |
| `RALPH: Generate PRD` | Generate a new `prd.json` from an existing file or prompt |
| `RALPH: Split PRD` | Split `prd.json` into `.prd/base_prd.json` and one file per story |
| `RALPH: Merge PRD` | Rebuild `prd.json` from split artifacts and non-completed stories |
| `RALPH: Edit User Stories` | Open the built-in split-story editor |
| `RALPH: Initialize Project Constraints` | Scan the workspace and generate project constraint artifacts |
| `RALPH: Record Design Context` | Capture per-story design context into a sidecar artifact |
| `RALPH: Recall Related Task Memory` | Preview or inject relevant prior task memory |
| `RALPH: Open Settings` | Open extension settings |
| `RALPH: Show Menu` | Open the status bar command menu |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ralph-runner.maxAutonomousLoops` | `2` | Maximum stories to execute per run |
| `ralph-runner.loopDelayMs` | `3000` | Delay between autonomous iterations |
| `ralph-runner.copilotResponsePollMs` | `5000` | Poll interval for completion detection |
| `ralph-runner.copilotTimeoutMs` | `3600000` | Per-story timeout |
| `ralph-runner.copilotMinWaitMs` | `15000` | Minimum wait before checking completion |
| `ralph-runner.autoInjectProjectConstraints` | `true` | Inject merged project constraints into story prompts |
| `ralph-runner.requireProjectConstraintsBeforeRun` | `false` | Block execution until project constraints are initialized |
| `ralph-runner.autoInjectDesignContext` | `true` | Inject per-story design context when available |
| `ralph-runner.requireDesignContextForTaggedStories` | `false` | Block design-sensitive stories when no design context is attached |
| `ralph-runner.autoRecallTaskMemory` | `true` | Recall and inject related prior task memory automatically |
| `ralph-runner.recalledTaskMemoryLimit` | `3` | Maximum memory entries to inject or preview |

## Maintaining Project Constraints

Treat `.ralph/project-constraints.generated.json` as generated output and `.github/ralph/project-constraints.md` as the document your team owns.

Recommended maintenance pattern:

1. Re-run `RALPH: Initialize Project Constraints` after meaningful changes to tooling, scripts, architecture, or folder layout.
2. Review `.github/ralph/project-constraints.md` and replace generic placeholders with real team rules.
3. Keep the editable file focused on durable guidance such as path restrictions, reuse expectations, coding standards, and delivery checklist items.
4. Avoid copying large raw docs into the editable file. Convert them into short, enforceable rules so prompt injection stays concise.

## How Execution Works

1. RALPH reads pending stories from `prd.json`.
2. It checks `.ralph/story-status.json`, `progress.txt`, and active lock files to determine what can run.
3. It loads merged project constraints, optional design context, and optional recalled task memory.
4. It composes a bounded prompt and sends it to Copilot Chat.
5. It waits for both a valid task memory artifact and the exact `completed` completion signal.
6. It updates progress and durable story state, then continues until the loop limit is reached.

## Local Development

1. Run `npm install`.
2. Run `npm run compile` to validate types, lint, and bundle output.
3. Run `npm test` to execute the VS Code extension test suite.
4. Run `npm run package` to build a production bundle.
5. Run `npm run package:vsix` to produce a local VSIX package.

## Known Constraints

- Completion still depends on Copilot writing the expected `completed` file signal.
- Prompt delivery falls back to clipboard if direct chat dispatch fails.
- The extension currently assumes a single workspace folder.

## Release Notes

### 0.0.4

- Added project constraints, design context recording, structured task memory, related memory recall, and ordered prompt composition.
