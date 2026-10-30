---
title: Graph that shows up while it is still being built
---
## App
### New
- The code graph shows what it has already indexed while a build is still running, instead of an empty panel with a spinner.
- An Alcore session that has expired now returns you to the sign-in screen, instead of leaving open a workspace where every request fails.
### Improvements
- The code graph refetches itself when a finished build publishes a new index, so an answer cached during the build cannot be replayed forever.
- Coming back to the window revalidates the index, at most once a minute.
- The projects counter in the index header reads "3/16 projects" instead of a doubled-brace template.
## VS Code
