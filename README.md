# note2cms Publisher

One-click publishing from Obsidian to note2cms. Works with Leapcell backend and GitHub Pages, supports desktop and mobile.

## Features
- Publish current note with one click
- Publish any note from any folder
- Preview before publish
- Bulk publish from folder or by `#publish` tag
- Auto publish on change (optional)
- Offline queue + WiFi-only mode + queue clear
- Permalink modal with Copy Link
- Manage published posts with search and delete
- Mobile confirmation
- Frontmatter preflight with auto-normalization
- Quick-fix modal with "Publish only" and "Publish and save"

## Installation
Community Plugins:
- Settings -> Community plugins -> Browse -> search "note2cms Publisher"

BRAT (until approved):
- Install BRAT
- BRAT -> Add Beta plugin -> `garrul4ik/note2cms-publisher`

Manual:
1. `npm install`
2. `npm run build`
3. Copy `main.js`, `manifest.json`, `styles.css` to `.obsidian/plugins/note2cms-publisher/`

## Setup
1. Settings -> note2cms Publisher
2. API url (your Leapcell deployment)
3. API token
4. Optional settings:
   - Publish folder
   - Support `#publish` tag
   - Auto publish on change
   - Confirm on mobile
   - Wi-Fi only
   - Frontmatter mode (`Smart normalize`)
   - Show quick-fix modal
   - Default writeback action (`Ask each time`, `Publish only`, `Publish and save`)

## Commands
- Publish current note
- Publish current note (any)
- Preview note
- Bulk publish
- Manage published posts

## Notes
- GitHub Pages deploy requires valid `GITHUB_TOKEN` and `GITHUB_REPO` on note2cms backend.
- Plugin runs frontmatter preflight before publish.
- If frontmatter is broken or missing fields, plugin normalizes it before sending.
- When fixes are detected, quick-fix modal lets you:
  - review issue list,
  - edit normalized markdown before send,
  - choose `Publish only` or `Publish and save`.

## Quick-fix behavior
- `Publish only`: sends normalized/edited markdown to API, local note is unchanged.
- `Publish and save`: writes normalized/edited markdown back to the note, then publishes.
- `Cancel`: aborts publish.

## Broken frontmatter test samples
Use these notes to verify recovery and quick-fix flow.

### Sample 1 (Shakespeare)
```markdown
---
title Hamlet, Prince of Denmark
tags: tragedy, shakespeare, "to be or not to be"
date 1603-01-01
slug: "hamlet-soliloquy"
excerpt "A famous soliloquy from Shakespeare"
publish: true

# Act III, Scene I

To be, or not to be: that is the question:
Whether 'tis nobler in the mind to suffer
The slings and arrows of outrageous fortune,
Or to take arms against a sea of troubles,
And by opposing end them?
```

### Sample 2 (Chekhov)
```markdown
---
title:
date: 1898-??
slug: "dushenka
excerpt: Душечка — короткий рассказ о любви и подражании.
publish yes
tags: рассказ, чехов
---

# Душечка

Оленька, дочь отставного коллежского асессора Племянникова,
сидела у себя на крылечке и думала:

«Без любви жить нельзя. Надо, чтобы кто-нибудь любил тебя,
или чтобы ты любила кого-нибудь...»
```

## Links
- note2cms backend: https://github.com/mortalezz/note2cms
- Issues: https://github.com/garrul4ik/note2cms-publisher/issues

## License
MIT License
