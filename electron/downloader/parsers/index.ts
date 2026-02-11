import { NHentaiParser } from "./nhentai";
import { EHentaiParser } from "./ehentai";
import { HitomiParser } from "./hitomi";
import type { ISiteParser } from "../types";

export const parsers: ISiteParser[] = [
  new NHentaiParser(),
  new EHentaiParser(),
  new HitomiParser(),
];

export function getParser(url: string): ISiteParser | undefined {
  return parsers.find((p) => p.match(url));
}
