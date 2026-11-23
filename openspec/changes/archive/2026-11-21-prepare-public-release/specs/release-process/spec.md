# Spec Delta

## Purpose

Defines how changes reach the main branch and become versioned releases: pull request title rules, the checks a change must pass, how version numbers and the changelog are derived from merged changes, and what must never be committed to the repository.

## ADDED Requirements

### Requirement: Conventional pull request titles
A pull request SHALL NOT be mergeable unless its title follows the Conventional Commits format `type(scope)!: summary`. The type SHALL be one of feat, fix, perf, revert, docs, style, refactor, test, build, ci or chore. The scope is optional and, when given, SHALL be one of runner, viewer, settings, packaging, release, deps or ci. The `!` is optional and marks a breaking change.

#### Scenario: Valid title
- **WHEN** a pull request is titled "fix(runner): find Node installed with fnm"
- **THEN** the title check passes

#### Scenario: Not a conventional title
- **WHEN** a pull request is titled "Update node.rs"
- **THEN** the title check fails and the pull request cannot be merged

#### Scenario: Unknown scope
- **WHEN** a pull request is titled "feat(sidebar): add icons"
- **THEN** the title check fails and names the allowed scopes

### Requirement: One squashed commit per pull request
Changes SHALL reach the main branch only through pull requests. Each pull request SHALL be merged by squashing into a single commit, whose message SHALL be the pull request title with no body.

#### Scenario: Direct push refused
- **WHEN** someone pushes a commit directly to the main branch
- **THEN** the push is rejected

#### Scenario: Merged pull request
- **GIVEN** a pull request titled "feat(viewer): two-column layout" with several commits
- **WHEN** it is merged
- **THEN** the main branch gains exactly one commit, whose message is "feat(viewer): two-column layout"

### Requirement: Checks required before merging
A pull request SHALL NOT be mergeable until all of these pass: the title check, formatting, linting, the Svelte checks, the script, app and Rust tests, the configuration and version checks, and the Windows installer build.

#### Scenario: Failing test
- **GIVEN** a pull request whose changes make an app test fail
- **WHEN** its checks finish
- **THEN** the pull request cannot be merged

#### Scenario: Unformatted file
- **GIVEN** a pull request containing a file that the formatter would change
- **WHEN** its checks finish
- **THEN** the formatting check fails, names the file, and the pull request cannot be merged

### Requirement: Version derived from merged changes
The next version SHALL follow semantic versioning based on the pull requests merged since the last release. A fix or perf bumps the patch version, a feat bumps the minor version, and a breaking change bumps the major version, except that before 1.0.0 a breaking change bumps the minor version. Other types SHALL NOT cause a release. The first release SHALL be 0.1.0.

#### Scenario: First release
- **GIVEN** the project has never been released
- **WHEN** the first release is proposed
- **THEN** its version is 0.1.0

#### Scenario: Fixes only
- **GIVEN** the last release is 0.2.0 and only fix pull requests were merged since
- **WHEN** the next release is proposed
- **THEN** its version is 0.2.1

#### Scenario: Feature
- **GIVEN** the last release is 0.2.1 and a feat pull request was merged since
- **WHEN** the next release is proposed
- **THEN** its version is 0.3.0

#### Scenario: Breaking change before 1.0
- **GIVEN** the last release is 0.3.0 and a pull request titled "feat(runner)!: new run folder format" was merged since
- **WHEN** the next release is proposed
- **THEN** its version is 0.4.0 and the change is listed as breaking

#### Scenario: Nothing user-facing
- **GIVEN** only docs, test and chore pull requests were merged since the last release
- **WHEN** they are merged
- **THEN** no release is proposed

### Requirement: Release pull request
Releasable changes merged to the main branch SHALL be collected in one open release pull request that sets the proposed version and adds the changelog entry. A release SHALL be created only when that pull request is merged, and its tag SHALL be `v` followed by the version.

#### Scenario: Changes accumulate
- **GIVEN** a feat pull request and a fix pull request were merged after the last release
- **WHEN** the release pull request is viewed
- **THEN** there is exactly one release pull request, and it lists both changes and proposes a single version

#### Scenario: Merging releases
- **WHEN** the release pull request proposing 0.1.0 is merged
- **THEN** a release tagged `v0.1.0` is created from that commit

#### Scenario: Nothing released without the release pull request
- **WHEN** feature pull requests are merged but the release pull request is not
- **THEN** no new tag or release exists

### Requirement: Changelog and release notes
`CHANGELOG.md` SHALL have one entry per release, newest first, headed by the version and date. Each entry SHALL list the releasable pull requests in groups (breaking changes, features, bug fixes, performance, reverts), each with its summary and a link to its pull request. Other types SHALL NOT be listed. The release's notes SHALL contain the same entry.

#### Scenario: Entry content
- **GIVEN** the pull requests "feat(viewer): two-column layout" and "fix(runner): find Node installed with fnm" are in a release
- **WHEN** the release is created
- **THEN** its changelog entry lists the first under features and the second under bug fixes, each with the scope in bold and a link to its pull request, and the release notes show the same entry

#### Scenario: Hidden types
- **GIVEN** a release also contains "chore(deps): bump vite" and "docs: clarify SmartScreen steps"
- **WHEN** the release is created
- **THEN** neither appears in the changelog entry or the release notes

#### Scenario: Edited before release
- **GIVEN** the maintainer rewords the entry in the release pull request's changelog and description
- **WHEN** the release pull request is merged
- **THEN** the changelog and the release notes contain the reworded entry

### Requirement: Local pre-commit check
In a developer's clone, committing SHALL first format and lint the files being committed, applying automatic fixes to them, and SHALL stop the commit if a problem remains that cannot be fixed automatically. Files that are not part of the commit SHALL NOT be changed.

#### Scenario: Auto-fixed
- **GIVEN** a staged Svelte file with formatting differences
- **WHEN** the developer commits
- **THEN** the file is formatted, and the commit contains the formatted version

#### Scenario: Problem that needs a person
- **GIVEN** a staged JavaScript file that uses an undefined variable
- **WHEN** the developer commits
- **THEN** the commit is stopped and the lint error is shown

### Requirement: No run output in the repository
The repository and its history SHALL NOT contain run folders, fetched Figma comments, frame images exported from Figma, or the `.env` file. Run folders that the scripts create inside the project folder SHALL be ignored by git.

#### Scenario: Running the scripts from the project folder
- **WHEN** a developer runs `npm run critique` in the project folder
- **THEN** git does not report the new run folder as a change

#### Scenario: History audit
- **WHEN** every commit reachable from the main branch is searched
- **THEN** none contains a `*-design-critique` folder, a `*-figma-comments*.json` file or a `.env` file

### Requirement: License
The repository SHALL include the MIT license, and the README SHALL name it.

#### Scenario: License present
- **WHEN** someone opens the repository
- **THEN** a `LICENSE` file with the MIT license text is at its root and the README states that the project is MIT licensed
