# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: the Sinapsi Alfa read over local Modbus TCP (read-only, one
  connection per read): powers drawn, fed, produced and used at home, the
  quarter-hour averages, the tariff band, the cut-off warning, and the
  lifetime energy drawn, fed and produced, each behind a guard (never 0, a
  drop or a jump held until accepted in two clicks).
- Test and "Accept the held index" buttons; documentation in English and
  French.
