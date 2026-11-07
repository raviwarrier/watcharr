# TODO

## Calibre and Audiobookshelf integration

Goal: when a book is imported or re-checked, detect whether you already own it in
Calibre (ebooks) or Audiobookshelf (audiobooks), and mark it as owned on the card
(the acquisition button). It should also run on demand from Settings, and optionally
after a library import finishes.

### Audiobookshelf (has an API)

1. Settings section with the server URL and an API token (stored encrypted, like the
   Hardcover token). Test the connection with a small request, like the Hardcover test.
2. Read the library items through the API and match them to watchlist books by ISBN when
   available, otherwise by normalized title and author surname.
3. A match marks `owned_audiobook`. Only add ownership; never clear it automatically.
4. Check the API docs for the current item and library endpoints before writing code.

### Calibre (no API; metadata.db is SQLite)

1. Settings: the path to the Calibre library folder (the one containing `metadata.db`).
   If Calibre runs on another machine, this path must be reachable from the VPS (for
   example a mounted share). Keep it read-only.
2. Open a copy of `metadata.db`, not the live file. Calibre keeps its own lock, and
   copying avoids interfering with it. Copy first, then read.
3. Read these tables:
   - `books`: id, title, sort, path
   - `authors` and `books_authors_link`: author names
   - `identifiers`: book id, type (for example `isbn`), value
   - `data`: book id, format (EPUB, PDF, M4B, MP3, ...)
4. Match on ISBN from `identifiers` first, then normalized title and author.
5. Ebook formats (EPUB, PDF, MOBI, AZW3, ...) mark `owned_ebook`. Audiobook formats
   (M4B, MP3, M4A, ...) mark `owned_audiobook`. Only add ownership.
6. Make sure the schema matches what the installed Calibre version writes. Check a
   real `metadata.db` before writing the queries.

### Triggers

- A "Check my library" action in Settings, with the time of the last check.
- Optional: run after a library import finishes (a setting, default off).
- Each check sends a Gotify message only if something new was marked.

### Open questions

- Does Calibre run on the same machine as Watcharr? (Decides the path setup.)
- Should a Calibre or Audiobookshelf match also count as "acquired" for the
  Upcoming/Released grouping? Today that grouping only uses release data.
- Which Audiobookshelf libraries to search, if there's more than one?

## Other

- Test a Hardcover CSV export with the library import. Check the column names and tag values.
- Hardcover account import, to add back later (read the "want to read" list through the API).
- Re-check a book's matching automatically after its title or author changes.
