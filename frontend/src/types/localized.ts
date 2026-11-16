export type SupportedLanguage = string;

export type LocalizedText = Partial<Record<SupportedLanguage, string>> & {
  vi: string;
};
