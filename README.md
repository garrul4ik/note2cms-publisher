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
2. API URL (your Leapcell deployment)
3. API Token
4. Optional settings: publish folder, tag, WiFi-only, auto publish

## Commands
- Publish current note
- Publish current note (any)
- Preview note
- Bulk publish
- Manage published posts

## Notes
- GitHub Pages deploy requires valid `GITHUB_TOKEN` and `GITHUB_REPO` on note2cms backend.
- Plugin injects `title` into frontmatter when missing.

## Links
- note2cms backend: https://github.com/mortalezz/note2cms
- Issues: https://github.com/garrul4ik/note2cms-publisher/issues

## License
MIT License
