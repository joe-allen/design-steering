# Spec Delta

## MODIFIED Requirements

### Requirement: macOS installer
The project SHALL produce a macOS `.dmg` installer for Apple Silicon (arm64) and one for Intel (x64), each containing an app named "Design Steering".

#### Scenario: Release build produces both macOS installers
- **WHEN** a release is created by merging the release pull request
- **THEN** one arm64 `.dmg` and one x64 `.dmg` are built and attached to that release

#### Scenario: Install by drag and drop
- **WHEN** a user opens a `.dmg` and drags the app into Applications
- **THEN** the app can be launched from Applications with no further installation steps

### Requirement: Windows installer
The project SHALL produce a Windows installer as an NSIS `-setup.exe` for x64, and SHALL NOT produce an MSI. The Windows installer SHALL also be built and checked for every pull request, and be downloadable from that pull request's checks.

#### Scenario: Release build produces the Windows installer
- **WHEN** a release is created by merging the release pull request
- **THEN** one `-setup.exe` is built and attached to that release

#### Scenario: Missing web view runtime
- **GIVEN** the target machine lacks the Microsoft WebView2 runtime
- **WHEN** the user runs the installer
- **THEN** the installer installs the runtime so the app can start

#### Scenario: Pull request build
- **WHEN** a pull request is opened or updated
- **THEN** exactly one `-setup.exe` and no MSI is built for it, and the `-setup.exe` can be downloaded from the pull request's checks

## ADDED Requirements

### Requirement: Complete releases only
A release SHALL stay an unpublished draft until the arm64 `.dmg`, the x64 `.dmg` and the `-setup.exe` are all attached to it, and SHALL be published only then. If any installer build fails, the release SHALL remain a draft and SHALL NOT be shown to users as the latest release.

#### Scenario: All installers built
- **WHEN** all three installer builds for a release succeed
- **THEN** the release is published with exactly two `.dmg` files and one `-setup.exe` attached, and no installer for any other platform

#### Scenario: One build fails
- **GIVEN** the Windows installer build for a release fails
- **WHEN** the release run ends
- **THEN** the release is still a draft, and the latest published release is unchanged

### Requirement: Consistent version
The version in `package.json`, the version the app reports, the version in `Cargo.toml` and `Cargo.lock`, the release tag, and the version in each installer's file name SHALL be identical. A pull request check or release build SHALL fail if any of them differ.

#### Scenario: Versions disagree
- **GIVEN** `Cargo.toml` says 0.1.0 and `package.json` says 0.2.0
- **WHEN** the pull request checks run
- **THEN** the version check fails and names both files and versions

#### Scenario: Release version everywhere
- **WHEN** the 0.1.0 release is built
- **THEN** each installer's file name contains 0.1.0, and the installed app reports version 0.1.0

#### Scenario: Tag mismatch
- **GIVEN** a release tagged `v0.2.0` whose `package.json` says 0.1.0
- **WHEN** the release builds run
- **THEN** they fail before building any installer, and the release stays a draft
