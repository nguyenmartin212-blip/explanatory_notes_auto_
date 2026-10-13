export type SupportedLanguage = 'vi' | 'en' | 'zh' | 'ko';

export type LocalizedText = Partial<Record<SupportedLanguage, string>> & {
  vi: string;
};
