# Spec Delta

## Purpose

Defines how Design Steering is built and distributed so that teammates can install it on macOS or Windows and use it without cloning the repo or running any package manager.

## ADDED Requirements

### Requirement: macOS installer
The project SHALL produce a macOS `.dmg` installer for Apple Silicon (arm64) and one for Intel (x64), each containing an app named "Design Steering".

#### Scenario: Release build produces both macOS installers
- **WHEN** the release workflow runs for a version tag
- **THEN** it produces one arm64 `.dmg` and one x64 `.dmg` and attaches them to that release

#### Scenario: Install by drag and drop
- **WHEN** a user opens a `.dmg` and drags the app into Applications
- **THEN** the app can be launched from Applications with no further installation steps

### Requirement: Windows installer
The project SHALL produce a Windows installer as an NSIS `-setup.exe` for x64, and SHALL NOT produce an MSI.

#### Scenario: Release build produces the Windows installer
- **WHEN** the release workflow runs for a version tag
- **THEN** it produces one `-setup.exe` and attaches it to that release

#### Scenario: Missing web view runtime
- **GIVEN** the target machine lacks the Microsoft WebView2 runtime
- **WHEN** the user runs the installer
- **THEN** the installer installs the runtime so the app can start

### Requirement: Native dependencies match the target
Each installer SHALL contain native dependencies built for its own operating system and CPU architecture.

#### Scenario: Native image library matches the target
- **WHEN** the arm64 macOS, x64 macOS and Windows installers are built
- **THEN** each one contains the image library binaries for its own operating system and CPU, and none contains binaries for another platform

### Requirement: Scripts and runtime dependencies are bundled
The installed app SHALL include the fetch and generate scripts and every runtime dependency they need, so that the user never runs `npm install`.

#### Scenario: Run with no install step
- **GIVEN** a machine with Node installed and no copy of the repository
- **WHEN** the user installs the app and runs the critique
- **THEN** the scripts start and draw the pin circles without any additional download or install

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
Installers SHALL be distributed unsigned, and the README SHALL explain how to open an unsigned app on macOS and Windows.

#### Scenario: First launch on macOS
- **WHEN** a user follows the README steps for macOS after Gatekeeper blocks the app
- **THEN** the README tells them how to open it anyway (right-click Open, or removing the quarantine attribute)

#### Scenario: First launch on Windows
- **WHEN** a user follows the README steps for Windows after SmartScreen warns
- **THEN** the README tells them how to continue past the warning ("More info", then "Run anyway")

### Requirement: Stable app identity
The app SHALL use the bundle identifier `com.designsteering.desktop` in every build, so that app data stays in the same location across versions.

#### Scenario: Upgrade by reinstalling
- **GIVEN** a user has run an earlier build and has saved settings and past runs
- **WHEN** they install a newer build over it
- **THEN** their settings and run history are still present
