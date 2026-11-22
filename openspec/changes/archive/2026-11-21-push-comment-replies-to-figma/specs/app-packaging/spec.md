# Spec Delta

## MODIFIED Requirements

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
