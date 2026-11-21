# critique-runner Specification

## Purpose

Defines how the app finds a suitable Node, runs the existing fetch and generate scripts on the user's behalf, reports progress and errors, and where it stores the results, including the small script additions this needs without changing command-line behavior.

## Requirements

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

### Requirement: Run source record
Each run folder SHALL contain a record of the page URL and run name the run was started with, written when the fetch succeeds, so the run can be synced later. The record SHALL NOT contain the token, and the fetch and generate scripts SHALL NOT need it. The recorded destination SHALL be checked against the snapshot before sending a batch.

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

#### Scenario: Source and snapshot do not agree
- **WHEN** a batch is requested for a run with a missing, invalid, or inconsistent source record
- **THEN** no write is made, the queue is preserved, and the app explains that a fresh run is needed

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

### Requirement: Preserve Figma thread identity
New comments JSON snapshots SHALL preserve the effective Figma file or branch key, comment ID, and parent comment ID (or no parent for a root) for each comment. They SHALL preserve enough reaction data to detect the done-mark on a root comment, while retaining the existing comment fields and JSON array shape.

#### Scenario: Fetch a branch with replies
- **GIVEN** a branch thread has a root comment and a reply that share the same displayed pin number
- **WHEN** the run fetches the branch
- **THEN** the snapshot identifies the branch, distinguishes each comment's ID, and records the reply's parent as the root ID

### Requirement: Keep the outbox private and run-local
The app SHALL persist queued actions and delivery results in the corresponding run folder separately from the fetched snapshot. The outbox SHALL NOT contain the Figma token. The app SHALL not export or copy the outbox to a new run, and removing the run SHALL remove its outbox without changing anything in Figma.

#### Scenario: Reopen a run after relaunch
- **GIVEN** an action has been queued or delivered
- **WHEN** the app is closed, reopened, and that run is selected from History
- **THEN** its outbox retains the action and status and is not merged into any other run

#### Scenario: Run removed
- **GIVEN** a run has both pending and delivered actions
- **WHEN** the user removes the run, individually or through "Remove all"
- **THEN** its outbox and any temporary copies are removed and no request is sent to Figma

### Requirement: Target only confirmed thread actions
The runner SHALL send only the reviewed actions after explicit confirmation. It SHALL validate the run's destination and each root comment, and target only the recorded Figma file or branch. It SHALL limit remote writes to posting replies and check-mark reactions on those roots.

#### Scenario: Reply to the original branch thread
- **GIVEN** a branch run has a queued reply for a thread with an existing reply
- **WHEN** the user confirms the batch
- **THEN** the runner posts a reply with the thread's root ID to the branch key, not the existing reply's ID or the base file's key

#### Scenario: Root already marked done
- **GIVEN** a teammate has added the check mark to the root since the run was saved
- **WHEN** the user confirms a batch containing a done-mark for that thread
- **THEN** the runner reports the action as already done without adding a reaction

#### Scenario: Destination or thread is invalid
- **WHEN** a queued action refers to a different file or branch, a reply rather than a root, or a root that no longer exists
- **THEN** the runner reports that the affected action could not be sent and does not redirect it to another thread or create a top-level comment

#### Scenario: Queue changes after review
- **WHEN** the contents of the reviewed batch differ from the current outbox at confirmation
- **THEN** no actions are sent until the user reviews and confirms the current batch

### Requirement: Checkpoint delivery per action
The runner SHALL record delivery attempts and outcomes per action. It SHALL not resend confirmed actions. An attempt whose outcome cannot be established SHALL be set aside for manual verification rather than retried automatically.

#### Scenario: Preserve partial success
- **GIVEN** Figma accepts a reply and rejects a later action in the batch
- **WHEN** the push finishes and the user confirms a retry of the rejected action
- **THEN** the accepted reply is not sent again

#### Scenario: Stop after uncertain delivery
- **WHEN** an attempt is interrupted after it may have reached Figma and no definitive result was saved
- **THEN** on reopening the run the attempt needs manual verification and later actions that were never attempted are still queued

### Requirement: Keep pushes separate from fetch permissions
Pushes SHALL use the saved token with access to the destination and the `file_comments:write` scope. The token SHALL be passed through the script's environment and SHALL NOT appear in arguments, logs, or run files. Fetch and Sync SHALL continue to work with read-only tokens.

#### Scenario: Figma refuses permission to write
- **GIVEN** the token can fetch the page but cannot write to it
- **WHEN** the user confirms a push
- **THEN** the runner reports the access error, preserves all unsent actions, and a later read-only Sync still works
