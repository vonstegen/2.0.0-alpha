# Runtime Handoff: issue-94-living-archive-copy

## Implementation Boundary

Change only user-facing Living Archive memory explanations and tests.

## Files In Scope

- `src/modules/archive/ArchiveMemoryOverview.tsx`
- `src/modules/archive/ArchiveLibraryImporter.tsx`
- `src/modules/archive/ArchiveWorkspace.tsx`
- `src/modules/settings/SettingsWorkspace.tsx`
- `src/App.tsx`
- `src/App.test.tsx`
- `public/addons/living-archive.json`

## Required Checks

- Focused App test for all affected UI surfaces.
- Full build.
- Full test suite, unless blocked by environment.

## Known External Blocker

Project item status cannot be moved to In Progress from this session because `gh` lacks the `project` write scope.
