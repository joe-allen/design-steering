# Changelog

## [0.2.0](https://github.com/joe-allen/design-steering/compare/v0.1.1...v0.2.0) (2026-11-23)


### Features

* **viewer:** push replies to Figma ([#9](https://github.com/joe-allen/design-steering/issues/9)) ([ad6a363](https://github.com/joe-allen/design-steering/commit/ad6a363f6cea5caba1f1ee84d59a986f627f382c))

## [0.1.1](https://github.com/joe-allen/design-steering/compare/v0.1.0...v0.1.1) (2026-11-19)


### Bug Fixes

* **packaging:** ad-hoc sign the macOS app so macOS no longer says it is damaged ([#7](https://github.com/joe-allen/design-steering/issues/7)) ([f5e2924](https://github.com/joe-allen/design-steering/commit/f5e29244780ccce3039b1211d0effb0db601f33e))

## 0.1.0 (2026-11-19)

First release of Design Steering. It pulls the comments from one Figma page and turns them into a markdown design critique, with a screenshot of each commented frame marked with numbered pins. Use it as a desktop app for macOS and Windows, or run the same two scripts from the command line.

- Get comments for a Figma page, see the critique rendered, and sync it again later
- Browse, search and remove past runs in History
- Download a run's markdown, comments and images as a folder
- Settings for the Figma token, frame images, comment authors and the Node path, with the app version shown

Requires Node.js 22.9 or later. The installers are not signed; see the README for first-launch steps. **The Windows installer is built and checked automatically but has not yet been tested on a Windows PC.**
