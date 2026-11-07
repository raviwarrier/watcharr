# Changelog

All notable changes to Watcharr are documented here.
Versions follow `X.Y.Z`: `Z` for bug fixes, `Y` for new features, and `X` for major changes.

## [0.6.4] - 2026-11-07

### Fixed
- `stop.sh` finds and stops a Watcharr server owned by another user on the port, using sudo (you may be asked for your password once). It still never stops anything that isn't a Next.js server on Watcharr's port.

## [0.6.3] - 2026-11-07

### Fixed
- `stop.sh` now also stops a Next.js server on Watcharr's port, even when its folder can't be matched. It prints the process it stopped.
- If the port is still in use after stopping, `stop.sh` and the install script say so and suggest a command to find the owner.

## [0.6.2] - 2026-11-07

### Fixed
- Stop scripts and the install script now stop a Watcharr server started by hand (for example with `next start`), not only one started by `start.sh` or `start.ps1`. Processes running from other folders are left alone.

## [0.6.1] - 2026-11-07

### Fixed
- A missing Hardcover token now returns a clear 400 with the message "Hardcover token not set. Add it in Settings." instead of a 502.
- The dashboard shows a banner with a link to Settings when the Hardcover token isn't set.
- When the server returns an error without a readable message (for example, a tunnel's 502 page), the dashboard explains that instead of showing "Request failed (502)".

## [0.6.0] - 2026-11-07

### Added
- Calendar menu in the header: **Download .ics file** and **Get subscription link**. The link is shown to signed-in users, so you don't need to keep the token.
- Caution zone at the bottom of Settings, with **Rotate calendar token** (the old subscription link stops working) and **Rotate access key** (signs out other browsers; the new key is shown once).
- Access key and calendar token are now stored in the encrypted settings. The access key was previously only in `.env.local`, which is still used as a fallback.

### Changed
- The install script stores the calendar token it creates, so the subscription link works from the start.
- Re-running the install script (for example after `git pull`) keeps your access key and calendar link. It asks "Create new access key and calendar link? [y/N]" (default no). Choosing yes replaces both keys, signs out other browsers, and shows the new keys once.

## [0.5.0] - 2026-11-07

### Added
- Access key. The install script creates a 64-character access key and shows it once. Only its hash is stored. Sign in with it at `/login`. Every page and API route requires a signed-in session.
- Calendar token. A second 64-character token, shown once, for the calendar feed URL (`/api/calendar.ics?token=...`). Calendar apps can subscribe without signing in.
- Sign out button, and a 30-day session.
- Sign-in attempts are limited to five wrong keys per 15 minutes.

### Changed
- The install script signs in with the new access key to save optional connection settings.

## [0.4.0] - 2026-11-07

### Added
- `ecosystem.config.js` for running Watcharr with PM2 on macOS, Linux, and Windows. PM2 can start it at boot.
- A systemd service block in `install.sh`. It's commented out, and the comments explain how to turn it on.

## [0.3.1] - 2026-11-07

### Fixed
- On Windows, the server ran in its own console window, and closing that window stopped the app. The server now runs with its window hidden. Used by `start.ps1` and `install.ps1`.

## [0.3.0] - 2026-11-07

### Added
- Install scripts (`install.sh` for macOS and Linux, `install.ps1` for Windows). They ask for the port, data folder, encryption key, and optional connections, install dependencies, create the database, build the app, and start it in the background.
- Start and stop scripts (`start.sh`/`stop.sh` and `start.ps1`/`stop.ps1`).

### Changed
- The data folder can be set with `DB_DIR`, and `drizzle-kit` reads the same setting.

## [0.2.0] - 2026-11-07

### Added
- Grid and list layouts for the watchlist. Your choice is remembered in the browser.

### Changed
- Removed the Tracked, Upcoming, Released, and Audiobook tiles. The counts are already on the filter tabs.
- The theme switch sits at the top right, next to Calendar feed.
- The Next.js development badge is hidden.

## [0.1.0] - 2026-11-07

First public version.

### Added
- Watchlist of books and authors. Search by title, author, or both, then pick the matching result.
- Watch all upcoming books by an author.
- Release status from Hardcover, with a second check on Apple Books for audiobooks Hardcover doesn't list.
- Ebook and audiobook availability, shown as pills with copy and open-link menus.
- Calendar feed (`.ics`) of expected release dates.
- Gotify push alerts when an ebook or audiobook becomes available, plus an optional summary after each scheduled re-check.
- Automatic re-check on a schedule: daily, every 7 days, every month (default), or every 3 months.
- Light, dark, and system themes.
- Encrypted storage (AES-256-GCM) for API tokens, server URLs, and other personal settings.

### Security
- Settings are encrypted by default. Only a short allowlist of preferences is stored in plain text.
- The settings API returns masked values. Full secrets never reach the browser.
