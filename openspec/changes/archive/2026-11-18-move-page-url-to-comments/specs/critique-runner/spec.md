# Spec Delta

## MODIFIED Requirements

### Requirement: Run sequence
A run SHALL execute the fetch script and then the generate script on the folder the fetch produced, using the saved Settings values together with the page URL and run name given for that run.

#### Scenario: Successful run
- **GIVEN** a valid token is saved and a page URL is given for the run
- **WHEN** the user clicks "Get comments" or "Sync comments"
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
- **THEN** the Comments screen shows a loading indicator and the current step in place of the page input form and the toolbar, so "Get comments", "Sync comments" and "New page" are unavailable until the run finishes or fails

## ADDED Requirements

### Requirement: Run source record
Each run folder SHALL contain a record of the page URL and run name the run was started with, written when the fetch succeeds, so the run can be synced later. The record SHALL NOT contain the token, and the scripts SHALL NOT need it.

#### Scenario: Record written
- **GIVEN** a run started with page URL A and run name "checkout"
- **WHEN** the run completes
- **THEN** its folder holds a record with page URL A and run name "checkout"

#### Scenario: Record without a run name
- **GIVEN** a run started with no run name
- **WHEN** the run completes
- **THEN** its record holds the page URL and an empty run name

#### Scenario: Token never recorded
- **GIVEN** a saved token
- **WHEN** a run completes
- **THEN** the token text appears nowhere in the run's record

#### Scenario: Record travels with the run
- **WHEN** the user downloads a run
- **THEN** the copied folder includes the record, and the markdown, JSON and images are unaffected by it

#### Scenario: Record cannot be written
- **WHEN** the record cannot be written after a successful fetch
- **THEN** the run fails with an error message and does not appear in History

### Requirement: Run deletion removes everything
Deleting a run SHALL remove its whole folder from the app's data folder, including the markdown, the comments JSON, the frame images and the source record, and SHALL leave no index, cache, trash copy or other trace of that run in the app's data. Deleting all runs SHALL also forget the remembered page URL. Deleting SHALL only ever affect run folders in the app's runs folder (and, for delete all, the remembered page URL), and SHALL NOT touch copies the user downloaded elsewhere.

#### Scenario: Run deleted completely
- **GIVEN** a completed run with images and a source record
- **WHEN** the run is deleted
- **THEN** its folder and everything in it no longer exist, and no other file in the runs folder refers to it

#### Scenario: Delete all
- **GIVEN** several completed runs
- **WHEN** all runs are deleted
- **THEN** every run folder is gone, the runs folder holds no run content, and the remembered page URL is forgotten

#### Scenario: Other data untouched
- **WHEN** a single run is deleted
- **THEN** other runs, the settings file and any downloaded copies are unchanged

#### Scenario: Delete all leaves other settings
- **WHEN** all runs are deleted
- **THEN** the token, toggles and Node path in the settings file are unchanged, and downloaded copies are untouched

#### Scenario: Only run folders can be deleted
- **WHEN** a deletion is requested for a name that is not a run folder in the runs folder (for example a path with `..`, an absolute path, or a link pointing outside)
- **THEN** nothing is deleted and an error is returned

#### Scenario: Incomplete runs are included
- **GIVEN** a run folder left by a failed run, which History does not list
- **WHEN** all runs are deleted
- **THEN** that folder is deleted too

#### Scenario: Partial failure
- **GIVEN** one run folder cannot be deleted
- **WHEN** all runs are deleted
- **THEN** the other run folders are still deleted, the error names the run that remains, and the remembered page URL is kept
