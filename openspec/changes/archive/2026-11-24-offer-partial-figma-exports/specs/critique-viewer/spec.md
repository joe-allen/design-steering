# Spec Delta

## ADDED Requirements

### Requirement: Review a partial export before saving

The desktop app SHALL offer **Save partial export** and **Discard** for a pending partial fetch or Sync. It SHALL show the number of confirmed threads, the known unreadable layer paths and IDs, and a notice that additional comments might be missing. Neither action SHALL modify Figma.

#### Scenario: Decision pending

- **WHEN** a partial candidate is ready
- **THEN** both actions are available, the incomplete candidate is not in History, and a second fetch, sync, or push cannot start before a decision

#### Scenario: Save the confirmed matches

- **WHEN** the user selects **Save partial export** and generation succeeds
- **THEN** the new partial critique opens and appears once in History; the previous run and any queued actions remain unchanged

#### Scenario: Discard from the form or from Sync

- **WHEN** the user selects **Discard**
- **THEN** no new critique is saved, the form or previously displayed run is restored as appropriate, and no prior run or outbox is deleted

#### Scenario: Close without accepting

- **WHEN** the user closes the app with a partial candidate awaiting a decision and reopens it
- **THEN** the unaccepted candidate is not published or offered as a saved run

### Requirement: Carry the incomplete-scan warning with the critique

An accepted partial run SHALL be labeled **Partial export** in History, its opened critique, and its downloaded Markdown. The warning in the critique and Markdown SHALL identify the unreadable layer paths and IDs, displayed as text, and SHALL distinguish confirmed matches from potentially missing comments.

#### Scenario: Reopen or share a partial run

- **WHEN** the user reopens the app, opens the partial run in either layout, or downloads it and reads the Markdown outside the app
- **THEN** the corresponding partial label remains visible, the confirmed threads remain available, and no local outbox content is exported

#### Scenario: Retry after repairing a layer

- **WHEN** a user selects **Sync comments** on a saved partial run and the new scan completes
- **THEN** the new run is not labeled partial and the original partial run retains its warning

#### Scenario: Legacy or complete run

- **WHEN** a user opens a complete run or a run saved before partial exports were supported
- **THEN** no partial label appears solely because the new metadata is absent
