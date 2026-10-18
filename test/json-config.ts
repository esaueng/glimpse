import { readFileSync } from "node:fs";
import { parse, type ParseError } from "jsonc-parser";

export function parseJsonConfig(source: string, path: string) {
  const errors: ParseError[] = [];
  const config = parse(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Invalid JSONC: ${path}`);
  return config;
}

export function readJsonConfig(path: string) {
  return parseJsonConfig(readFileSync(path, "utf8"), path);
}
