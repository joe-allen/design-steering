# Spec Delta

## Purpose

Defines how the app finds a suitable Node, runs the existing fetch and generate scripts on the user's behalf, reports progress and errors, and where it stores the results, including the small script additions this needs without changing command-line behavior.

## ADDED Requirements

### Requirement: Node discovery
The app SHALL find a Node 22.9 or later installation without the user editing any path, by trying, in order: the Node path from Settings, the Node found by the user's login shell (macOS), and the standard install locations for the operating system.

#### Scenario: Node installed via a version manager on macOS
- **GIVEN** Node is available in the user's terminal but not on the default PATH of apps launched from Finder
- **WHEN** the user clicks "Get comments"
- **THEN** the app finds that Node and runs the scripts with it

#### Scenario: Node installed on Windows after the app was opened
- **GIVEN** the app was opened before Node was installed
- **WHEN** the user clicks "Get comments" or the Node Detect action
- **THEN** the app finds Node at its standard install location without restarting

#### Scenario: Explicit path wins
- **GIVEN** a valid Node path is saved in Settings
- **WHEN** a run starts
- **THEN** the app uses that Node and not an auto-discovered one

### Requirement: Node requirement errors
If no Node is found, or the Node found is older than 22.9, the app SHALL NOT start a run and SHALL show a message that says Node 22.9 or later is required, gives the version it found if any, and says how to proceed.

#### Scenario: Node missing
- **WHEN** no Node can be found and the user clicks "Get comments"
- **THEN** the app shows that Node 22.9 or later is required, tells the user to install it and then use Detect (or restart the app), and links to the README

#### Scenario: Node too old
- **GIVEN** the only Node found is version 20
- **WHEN** the user clicks "Get comments"
- **THEN** the app reports the version found and that 22.9 or later is required

### Requirement: Run sequence
A run SHALL execute the fetch script and then the generate script on the folder the fetch produced, using the saved settings.

#### Scenario: Successful run
- **GIVEN** a valid token and page URL are saved
- **WHEN** the user clicks "Get comments"
- **THEN** a run folder containing the comments JSON, the frame images and the generated markdown exists, and the app shows its rendered markdown

#### Scenario: Fetch fails
- **WHEN** the fetch script exits with an error (for example Figma returns 403)
- **THEN** the generate script is not run, no new entry appears in History, and the app shows the script's error message

#### Scenario: Generate fails
- **GIVEN** the fetch script succeeded but the generate script exits with an error
- **WHEN** the run ends
- **THEN** the app shows the error and the run does not appear in History

### Requirement: Progress and single run
While a run is in progress the app SHALL show the scripts' output as it arrives and SHALL NOT allow a second run to start.

#### Scenario: Live output
- **WHEN** a run is in progress
- **THEN** progress lines from the scripts (such as the resolved page name and the number of PNGs saved) appear in the app as they are printed

#### Scenario: Button disabled during run
- **WHEN** a run is in progress
- **THEN** the "Get comments" action is disabled until the run finishes or fails

### Requirement: Token passed privately
The app SHALL give the token to the scripts through the process environment and SHALL NOT place it on the command line.

#### Scenario: Token not visible in the process list
- **WHEN** a run is in progress and the process list is inspected
- **THEN** the scripts' command lines do not contain the token

### Requirement: Run storage
Each run SHALL be written to its own folder under the app's data folder, using the same naming as the command-line scripts (`<name>-design-critique`, then `-1`, `-2` for repeats), and an existing run folder SHALL NOT be overwritten.

#### Scenario: Repeat run
- **GIVEN** a run folder named `home-design-critique` already exists
- **WHEN** another run for the same page completes
- **THEN** its output is in `home-design-critique-1` and the earlier folder is unchanged

### Requirement: Output location option
The fetch and generate scripts SHALL accept an option to set the folder that holds run folders, and without it SHALL behave exactly as before by using the folder containing the scripts.

#### Scenario: Output folder given
- **WHEN** the fetch script is run with the output folder option set to a path
- **THEN** the run folder is created inside that path and the generate script, given the same option, finds the most recent run folder there

#### Scenario: Default unchanged
- **WHEN** the scripts are run from the command line with no new options
- **THEN** run folders are created and found next to the scripts as they were before this change

### Requirement: Machine-readable result
The fetch script SHALL support an option that prints, as its last line of standard output, the path of the run folder it created, so a caller does not have to parse log messages.

#### Scenario: Result line
- **WHEN** the fetch script succeeds with that option
- **THEN** the last line of standard output is the absolute path of the new run folder

### Requirement: Generate without images
The generate script SHALL succeed when the run folder has no `_frames` folder, listing every comment under "General comments".

#### Scenario: Run fetched without images
- **GIVEN** a run folder created with images turned off
- **WHEN** the generate script runs on it
- **THEN** it writes the markdown with all comments under "General comments" and exits successfully
