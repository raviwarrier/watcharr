/**
 * Name matching shared by the importer and the library reconciliation.
 * Titles and names are compared loosely: case, accents, punctuation and subtitles are ignored.
 */

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Title without subtitle or series part: "Dune: Book One (Dune)" -> "dune". */
export function titleBase(title: string): string {
  return normalise(title.split(/[:(]/)[0] ?? "");
}

export function firstAuthor(author: string): string {
  return (author.split(/[;,]/)[0] ?? "").trim();
}

export function surname(name: string): string {
  const parts = normalise(name).split(" ");
  return parts[parts.length - 1] ?? "";
}
