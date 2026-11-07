# Security policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please don't open a public issue for security problems.

Report them privately through GitHub's
[private vulnerability reporting](../../security/advisories/new) for this repository.
Include the affected version, steps to reproduce, and the impact you expect.
You'll get an acknowledgement within a week.

## How secrets are handled

- Settings with personal or secret values (the Hardcover token, the Gotify URL and token, and the webhook URL) are encrypted with AES-256-GCM before they're written to the database.
- The encryption key comes from `APP_SECRET_KEY` if set, or from `data/.secret-key`, which is created on first use. Anyone with access to both the database and the key can read your secrets, so keep `data/` private and back it up as one unit.
- The settings API returns masked values only. Tokens are never sent back to the browser after they're saved.
- `data/` and `.env*` files are gitignored.

## Known limits

- On Windows, the owner-only file mode on `data/.secret-key` isn't enforced. Protection depends on your user-profile permissions.
- Watcharr is meant for a single user on a machine you control. It has no login, so don't expose it to the internet without a reverse proxy that handles authentication.
