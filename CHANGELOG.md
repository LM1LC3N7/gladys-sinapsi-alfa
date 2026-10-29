# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-29

### Fixed

- The counter guard keeps the value you accepted as a floor: after an
  accepted drop, a reading lower still is held (never counted without
  a new click) and the real value that follows is taken instead of being
  held as a jump; a reading back under an accepted jump is now held too and
  needs a new click.

## [0.1.1] - 2026-10-27

### Added

- First version: the Sinapsi Alfa read over local Modbus TCP (read-only, one
  connection per read): powers drawn, fed, produced and used at home, the
  quarter-hour averages, the tariff band, the cut-off warning, and the
  lifetime energy drawn, fed and produced, each behind a guard (never 0, a
  drop or a jump held until accepted in two clicks).
- Test and "Accept the held index" buttons; documentation in English and
  French.

[Unreleased]: https://github.com/LM1LC3N7/gladys-sinapsi-alfa/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-sinapsi-alfa/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-sinapsi-alfa/releases/tag/v0.1.1
