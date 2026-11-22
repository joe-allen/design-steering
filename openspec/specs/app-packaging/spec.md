# app-packaging Specification

## Purpose

Defines how Design Steering is built and distributed so that teammates can install it on macOS or Windows and use it without cloning the repo or running any package manager.

## Requirements

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

### Requirement: Native dependencies match the target
Each installer SHALL contain native dependencies built for its own operating system and CPU architecture.

#### Scenario: Native image library matches the target
- **WHEN** the arm64 macOS, x64 macOS and Windows installers are built
- **THEN** each one contains the image library binaries for its own operating system and CPU, and none contains binaries for another platform

### Requirement: Scripts and runtime dependencies are bundled
The installed app SHALL include the fetch, generate, and push scripts and every runtime dependency they need, so that the user never runs `npm install`.

#### Scenario: Run with no install step
- **GIVEN** a machine with Node installed and no copy of the repository
- **WHEN** the user installs the app and runs the critique
- **THEN** the scripts start and draw the pin circles without any additional download or install

#### Scenario: Push with no install step
- **GIVEN** the user has installed the app and Node, but has no copy of the repository
- **WHEN** the user confirms a push with a valid write-scoped token
- **THEN** the app runs the bundled push script without requiring an additional install or the source checkout

### Requirement: Development tooling is not shipped
The installer SHALL contain only the dependencies the scripts need at runtime, and SHALL NOT contain OpenSpec or other development tooling.

#### Scenario: Installer contents
- **WHEN** the bundled dependency folder is inspected
- **THEN** it contains the image library and its own dependencies and does not contain OpenSpec

### Requirement: Node is a documented prerequisite
The README SHALL state that Node 22.9 or later must be installed, and the installers SHALL NOT bundle Node.

#### Scenario: Prerequisite documented
- **WHEN** a user reads the install section of the README
- **THEN** it lists Node 22.9 or later as required and shows how to check the installed version

### Requirement: Unsigned builds are documented
Installers SHALL NOT be signed with an Apple Developer ID or a Windows code-signing certificate, and SHALL NOT be notarized. The macOS app SHALL carry a valid ad-hoc signature covering the whole app bundle, so that macOS offers to open a downloaded copy instead of reporting it as damaged. The README SHALL explain how to open the app on macOS and Windows.

#### Scenario: First launch on macOS
- **WHEN** a user follows the README steps for macOS after macOS blocks the app
- **THEN** the README tells them how to open it anyway ("Open Anyway" in Privacy & Security, or removing the quarantine attribute)

#### Scenario: Downloaded macOS app is not reported as damaged
- **GIVEN** the arm64 `.dmg` was downloaded from a release with a web browser
- **WHEN** the user opens the app from Applications
- **THEN** macOS says it could not verify the app, not that the app is damaged, and Privacy & Security offers "Open Anyway"

#### Scenario: Signature checked in every macOS build
- **WHEN** a macOS installer is built
- **THEN** the build fails unless the app inside the `.dmg` passes strict signature verification

#### Scenario: First launch on Windows
- **WHEN** a user follows the README steps for Windows after SmartScreen warns
- **THEN** the README tells them how to continue past the warning ("More info", then "Run anyway")

### Requirement: Stable app identity
The app SHALL use the bundle identifier `com.designsteering.desktop` in every build, so that app data stays in the same location across versions.

#### Scenario: Upgrade by reinstalling
- **GIVEN** a user has run an earlier build and has saved settings and past runs
- **WHEN** they install a newer build over it
- **THEN** their settings and run history are still present

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
