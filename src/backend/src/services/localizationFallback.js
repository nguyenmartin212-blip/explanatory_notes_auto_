// Localization rules: fallback order, narration text and audio validity.
// Fallback order (Chapter 05): requested language -> English -> Vietnamese.
// A whole localization is picked (never mixed field by field) so the text and the audio the client plays
// are always in the same language.
import crypto from 'node:crypto';

export const FALLBACK_TAIL = ['en', 'vi'];

export function fallbackChain(requested) {
  const chain = [];
  for (const language of [requested, ...FALLBACK_TAIL]) {
    if (language && !chain.includes(language)) chain.push(language);
  }
  return chain;
}

/** Text the audio is generated from: tts_script, else the description. */
export function narrationText(loc) {
  return ((loc.tts_script || '').trim() || (loc.description || '').trim());
}

export function computeContentHash(language, text) {
  return crypto.createHash('sha256').update(`${language}\n${text}`, 'utf8').digest('hex');
}

/** A localization can be shown to users only with a name and a description. */
export function isUsable(loc) {
  return Boolean(loc && (loc.name || '').trim() && (loc.description || '').trim());
}

/** Audio is valid only if it is ready and was generated from the current text. */
export function hasValidAudio(loc) {
  return Boolean(
    loc && loc.audio_status === 'ready' && loc.audio_url && loc.audio_hash && loc.audio_hash === loc.content_hash,
  );
}

export function publicLocalization(loc) {
  return {
    name: loc.name ?? '',
    description: loc.description ?? '',
    tts_script: loc.tts_script ?? null,
    audio_url: hasValidAudio(loc) ? loc.audio_url : null,
  };
}

/** Pick the localization to serve: requested -> en -> vi. null if none is usable. */
export function resolveContent(localizations, requested) {
  for (const language of fallbackChain(requested)) {
    const loc = localizations[language];
    if (isUsable(loc)) {
      return {
        language_requested: requested ?? null,
        language_served: language,
        fallback: Boolean(requested) && language !== requested,
        ...publicLocalization(loc),
      };
    }
  }
  return null;
}
