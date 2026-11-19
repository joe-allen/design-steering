# Spec Delta

## ADDED Requirements

### Requirement: App version shown
The Settings screen SHALL show the version of the running app, as "Version" followed by the version number.

#### Scenario: Installed release
- **GIVEN** the 0.1.0 release is installed
- **WHEN** the user opens Settings
- **THEN** it shows "Version 0.1.0"

#### Scenario: After upgrading
- **GIVEN** a user upgrades from 0.1.0 to 0.2.0 by installing the newer build
- **WHEN** they open Settings
- **THEN** it shows "Version 0.2.0"
