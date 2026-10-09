import type { Credit } from "@/content/credits";

/** File extensions that count as a bundled font. */
export const FONT_EXTENSIONS = [".woff", ".woff2", ".ttf", ".otf", ".eot"];

const packageCredits = (credits: Credit[]) => credits.filter((c) => c.kind === "package");

/** Packages a credit names that are not in the given dependency list. Only `package` credits are checked. */
export function stalePackages(credits: Credit[], dependencies: string[]): string[] {
  const have = new Set(dependencies);
  return packageCredits(credits)
    .flatMap((c) => c.packages ?? [])
    .filter((name) => !have.has(name));
}

/** Dependencies that no `package` credit names. */
export function uncreditedPackages(credits: Credit[], dependencies: string[]): string[] {
  const credited = new Set(packageCredits(credits).flatMap((c) => c.packages ?? []));
  return dependencies.filter((name) => !credited.has(name));
}

/** Bundled files (fonts, data sources) that no credit names. */
export function uncreditedFiles(credits: Credit[], files: string[]): string[] {
  const credited = new Set(credits.flatMap((c) => c.files ?? []));
  return files.filter((f) => !credited.has(f));
}

/** Files a credit names that are not among the bundled files. */
export function staleFiles(credits: Credit[], files: string[]): string[] {
  const have = new Set(files);
  return credits.flatMap((c) => c.files ?? []).filter((f) => !have.has(f));
}
