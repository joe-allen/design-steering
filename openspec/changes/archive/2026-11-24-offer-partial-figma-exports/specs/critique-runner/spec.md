# Spec Delta

## MODIFIED Requirements

### Requirement: Run sequence

A run SHALL execute the fetch script and then the generate script on the folder the fetch produced, using the saved Settings values together with the page URL and run name given for that run. If the desktop fetch produces a partial candidate, generation and publication SHALL wait for explicit acceptance.

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

#### Scenario: Partial candidate is not a completed run

- **WHEN** a desktop fetch has confirmed threads and an incomplete layer scan
- **THEN** the runner retains the candidate privately until a decision, without publishing a run; accepting generates a new critique from those same matches without refetching, and discarding does not generate one

## ADDED Requirements

### Requirement: Isolate unreadable layer branches

During desktop pin matching, the runner SHALL attempt bounded recovery from persistent Figma server errors on layer reads, retain confirmed threads including replies, and distinguish unreadable branches from readable siblings. The summary SHALL identify the deepest known unreadable paths and layer IDs without guessing which descendants or how many comments are missing.

#### Scenario: One bad branch among readable siblings

- **GIVEN** a thread was matched to a top-level frame and a batch containing two child branches returns 500 after retry
- **WHEN** one branch cannot be read even individually and the other contains a matching thread
- **THEN** both confirmed threads and their replies are retained, only the unreadable branch is reported, and an unrelated file or page comment is not included

#### Scenario: Smaller requests recover the batch

- **WHEN** smaller lookups recover every branch of a failed batch
- **THEN** the result is complete, with no partial warning or decision

#### Scenario: No confirmed threads in an incomplete scan

- **WHEN** one or more branches could not be scanned and no thread can be confirmed on the page
- **THEN** the runner names the incomplete scan without asserting the page has no comments, and offers nothing to save

#### Scenario: Recovery is not a general error fallback

- **WHEN** page resolution or the comments feed fails, access is denied, or a rate limit persists after retry
- **THEN** the runner reports the error without offering a partial export

#### Scenario: Default CLI remains strict

- **WHEN** a standalone fetch without desktop partial handling encounters an unrecoverable layer-read error
- **THEN** it exits unsuccessfully without publishing a partial run or prompting on stdin
