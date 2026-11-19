# Spec Delta

## Purpose

Defines the Settings screen and the values it persists, which mirror the options of the existing command-line scripts, and how the Figma token is stored and protected.

## ADDED Requirements

### Requirement: Settings fields
The Settings screen SHALL provide fields for the Figma personal access token, the Figma page URL and an optional run name, toggles for including frame images (default on) and showing the comment author (default off), and an optional Node path.

#### Scenario: First launch defaults
- **GIVEN** the app has never been configured
- **WHEN** the user opens Settings
- **THEN** the token, page URL, run name and Node path are empty, the images toggle is on and the author toggle is off

### Requirement: Settings persist
Saving SHALL store all settings so they are restored after the app is closed and reopened.

#### Scenario: Save and relaunch
- **WHEN** the user enters a token and page URL, saves, quits and reopens the app
- **THEN** Settings shows the saved page URL, the same toggle states, and a token field that is populated but masked

#### Scenario: Save confirmation
- **WHEN** the user saves
- **THEN** the app confirms the save, or shows an error if the settings could not be written

### Requirement: Token handling
The token field SHALL be masked and SHALL provide a way to clear the saved token. The token SHALL be stored only in the app's settings file and SHALL NOT appear in any log pane, run folder, generated markdown, or history label.

#### Scenario: Token never shown after entry
- **GIVEN** a saved token
- **WHEN** a run completes and the user views its output, history entry and log
- **THEN** the token text appears in none of them

#### Scenario: Clear token
- **WHEN** the user clears the token and saves
- **THEN** no token remains stored and the next run asks for one

### Requirement: Required values before a run
A run SHALL NOT start while the token or page URL is empty. The app SHALL tell the user which value is missing and direct them to Settings.

#### Scenario: Missing token
- **GIVEN** a page URL is saved but no token
- **WHEN** the user clicks "Get comments"
- **THEN** no run starts and a message says the Figma token is missing and points to Settings

### Requirement: Settings map to script options
Each setting SHALL correspond to exactly one existing script option: page URL, token, run name, images toggle and author toggle.

#### Scenario: Run name used as folder name
- **GIVEN** the run name is set to "checkout"
- **WHEN** a run completes
- **THEN** the run folder is named `checkout-design-critique` (or its next free numbered form)

#### Scenario: Images off
- **GIVEN** the images toggle is off
- **WHEN** a run completes
- **THEN** no frame images are exported, the run still succeeds, and the preview lists every comment under "General comments" without images

#### Scenario: Author shown
- **GIVEN** the author toggle is on
- **WHEN** a run completes
- **THEN** each comment in the generated markdown is followed by its author's handle in parentheses
