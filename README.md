# RALPH Runner

RALPH (Run Autonomous Loops Per Handoff) is a VS Code extension that turns `prd.json` user stories into a context-aware execution loop for GitHub Copilot Chat. It still manages autonomous story execution, but now enriches each prompt with project constraints, per-story design context, recalled task memory, and a stricter completion contract before a story is considered done.

Use it when you want Copilot to execute a queue of implementation stories while preserving repo-specific rules, UI intent, and prior decisions across the run.

RALPH also contributes a Copilot Chat participant command for constraint-aware prompt finalization: use `@ralph /ralph-spec <your request>` to refine a task description or implementation idea, absorb the relevant constraint-driven adjustments, and then auto-send the finalized execution prompt to Copilot Chat.

## What RALPH Does

- Runs user stories in priority order from `prd.json`
- Persists workflow state in `.ralph/` so execution is resumable
- Lets Copilot append new user stories into the existing `prd.json`
- Scans the workspace to generate machine-readable and editable project constraints
- Stores layered design context in `.prd/design-context/` with reusable shared artifacts and story-level overrides
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
| `.prd/design-context/US-xxx.design.json` | Story-specific design context override or review draft |
| `.prd/design-context/shared/project.design.json` | Shared project-wide design defaults |
| `.prd/design-context/shared/screen-<id>.design.json` | Reusable screen-level design context |
| `.prd/design-context/shared/module-<id>.design.json` | Reusable module-level design context |
| `.ralph/design-context-suggestions/US-xxx.suggestion.json` | Temporary story suggestion artifact generated before save |
| `progress.txt` | Append-only execution log of done or failed outcomes |

## Context-Aware Workflow

### 1. Generate the PRD

Use `RALPH: Generate PRD` to create the root PRD. When new scope appears later, use `RALPH: Append User Stories` to ask Copilot to update the existing `prd.json` in place.

When generating or appending stories, RALPH now keeps the PRD focused on requirement-related user stories only. It detects whether the workspace is a Git repository and combines that with the `ralph-runner.autoCommitGit` setting to decide whether implementation stories should handle their own commits during execution, instead of generating separate Git commit stories.

### 2. Initialize project constraints

Run `RALPH: Initialize Project Constraints` before executing stories that need repo-specific guidance.

The command scans the workspace for:

- `package.json` scripts and dependencies
- `tsconfig.json`
- ESLint configuration
- `README.md`
- common source, test, docs, and script directories

It writes two artifacts:

- `.ralph/project-constraints.generated.json` for normalized machine-readable prompt injection
- `.github/ralph/project-constraints.md` for human-maintained overrides and rules

The generated defaults are intentionally generic. They summarize common engineering signals such as scripts, source roots, linting, test locations, reusable-module guidance, likely editable paths, and likely generated output directories. Repo-specific workflow rules should be added manually in the editable constraints file instead of being inferred automatically.

### 3. Build layered design context for UI-sensitive work

The design workflow is now layered instead of story-only.

Use `RALPH: UI Design Notes` as the single entry for UI-related setup.

1. Choose `Prepare Reusable Notes` when you want to import screenshots, a Figma link, or both and save reusable UI guidance under `.prd/design-context/shared/`.
2. Choose `Match One Story` when you only need to prepare the current story, optionally matching existing project, screen, or module notes.
3. Inside the story path, either auto-prepare lightweight story notes or import story-specific visuals.

Shared and story artifacts can capture:

- Figma URL
- screenshot paths
- reference docs
- summary and manual notes
- layout constraints
- component reuse targets
- token rules
- responsive rules
- protected UI regions
- explicit visual acceptance checks

Use shared artifacts when the same shell, layout, or component rules apply across multiple stories. Use story-level artifacts only for deltas such as one-off spacing, acceptance, or protected-area refinements.

The UI notes flow is designed to reduce repeated entry. The primary interaction is no longer a long manual questionnaire. Instead, the single command lets the user:

- confirm inherited shared context
- match the story to project, screen, or module artifacts
- auto-generate a lightweight story-level description
- import Figma or screenshots when a fresh description is needed

Attach or review design context when a story changes any of the following:

- page layout or information hierarchy
- reusable UI components
- color, spacing, or typography tokens
- responsive behavior
- a designer-approved acceptance target

### 4. Lazy design synthesis during execution

RALPH can now synthesize a bounded Design Context section at execution time for design-sensitive stories when no explicit story-level artifact exists.

The runtime uses, in order of preference:

- linked or inferred shared project, screen, and module design context
- visual references already captured in shared context
- the current story title, description, and acceptance criteria

The injected synthesis is intentionally compact. It focuses on execution-critical fields such as visual inputs, layout focus, reuse focus, token focus, protected areas, and acceptance focus, instead of dumping raw notes.

This means most UI stories no longer need a fully completed story-level design file before execution. Shared context plus story metadata is often enough.

### 5. Execute or preview memory recall

Run `RALPH: Recall Related Task Memory` to preview which prior stories are likely relevant to the current work. During normal execution, RALPH can also do this automatically and inject a bounded `Relevant Prior Work` section.

Recall scoring uses:

- related or dependent story IDs
- keyword overlap
- module hints
- changed file overlap
- recency

### 6. Start autonomous execution

When you run `RALPH: Start`, RALPH composes a prompt in this fixed order:

1. System execution rules
2. Project constraints
3. Design context
4. Relevant prior work
5. Current story
6. Completion contract

The prompt remains bounded so optional context does not overwhelm the current task.

### 7. Require task memory before completion

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
| `RALPH: Append User Stories` | Ask Copilot to append new user stories into the existing `prd.json` |
| `RALPH: Initialize Project Constraints` | Scan the workspace and generate project constraint artifacts |
| `RALPH: UI Design Notes` | Single entry for UI design setup: match one story, import story visuals, or prepare reusable project/screen/module notes |
| `RALPH: Open Settings` | Open extension settings |
| `RALPH: Show Menu` | Open the status bar command menu |

## Copilot Chat Command

After you initialize project constraints, you can ask Copilot Chat to refine a request against those rules with:

`@ralph /ralph-spec <your description>`

Use it when you want RALPH to:

- rewrite a vague change request into a repo-specific implementation brief
- absorb the useful revision advice into a final prompt you can give directly to another model
- automatically forward that finalized prompt into a fresh Copilot Chat for execution
- point out only the remaining conflicts or missing information after producing the final version

The command reads the merged constraints from `.ralph/project-constraints.generated.json` and `.github/ralph/project-constraints.md`, so manual overrides in the editable markdown file take precedence. The output is intended to be execution-ready, not just advisory.

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
| `ralph-runner.autoInjectDesignContext` | `true` | Inject resolved or synthesized design context when available |
| `ralph-runner.requireDesignContextForTaggedStories` | `false` | Block design-sensitive stories only when no explicit or synthesized design coverage is available |
| `ralph-runner.autoRecallTaskMemory` | `true` | Recall and inject related prior task memory automatically |
| `ralph-runner.autoCommitGit` | `true` | When a Git repository is detected, ask Copilot to commit within the same implementation story instead of relying on separate Git commit stories |
| `ralph-runner.recalledTaskMemoryLimit` | `3` | Maximum memory entries to inject or preview |
| `ralph-runner.language` | `Chinese` | Switch runtime UI language between Chinese and English |

## Visual Design Workflow

Use this workflow for UI-heavy work:

1. Open `RALPH: UI Design Notes`.
2. Use `Prepare Reusable Notes` to generate shared project, screen, or module guidance from screenshots, Figma, or both.
3. Use `Match One Story` to apply those reusable notes to a specific story.
4. If the story has special visuals, import story-level screenshots or Figma from the same entry.
5. Let runtime synthesis fill in the gap when a design-sensitive story only has shared context available.

This approach keeps prompts concise while preserving reusable visual decisions.

Choose visual import when the source of truth is a mockup, screenshot set, or Figma file. Choose lightweight review when the story mostly inherits an existing shell and only needs confirmation or a small override.

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

If the repository does not include a LICENSE file, package with `npx @vscode/vsce package --skip-license` to avoid the interactive packaging prompt.

## Known Constraints

- Completion still depends on Copilot writing the expected `completed` file signal.
- Prompt delivery falls back to clipboard if direct chat dispatch fails.
- The extension currently assumes a single workspace folder.

## Release Notes

### 0.0.6

- Added layered shared design context for project, screen, module, and story scopes.
- Added visual design draft generation from Figma and screenshots.
- Added story-level suggestion flow that writes only deltas beyond inherited shared context.
- Added execution-time lazy design synthesis for design-sensitive stories.
- Reworked the design-context UX around review-first drafts with advanced manual entry as a fallback.
