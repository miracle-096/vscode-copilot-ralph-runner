# Change Log

All notable changes to the "ralph-runner" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.0.9] - 2026-04-05

- Moved runtime artifacts and project constraints from .ralph and .github into .harness-runner only.
- Removed legacy .ralph and .github path compatibility from the extension, docs, tests, and checked-in artifacts.

## [0.0.8] - 2026-04-03

- Added the new run-check configuration command and approval prompt mode.
- Simplified run-check wording in commands and settings.
- Hid legacy compatibility toggles from the Settings UI while keeping backward-compatible reads.