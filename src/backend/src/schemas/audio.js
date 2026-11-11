// Request models for the audio module.
import { SUPPORTED_LANGUAGES, supportedLanguage } from './content.js';
import { Collector, requireBody, str } from './validate.js';

export const MAX_TTS_TEXT_CHARS = 5000;

/**
 * POST /audio/tts body. `text` is spoken in `lang`. If `source_lang` is given and differs from `lang`,
 * the text is first translated from `source_lang` to `lang`.
 */
export function parseTtsRequest(body) {
  requireBody(body);
  const c = new Collector();
  const out = { text: undefined, lang: undefined, source_lang: null };
  if (!('text' in body)) c.add('text', 'Field required');
  else out.text = str(c, 'text', body.text, { min: 1, max: MAX_TTS_TEXT_CHARS, strip: true });
  if (!('lang' in body)) c.add('lang', 'Field required');
  else out.lang = supportedLanguage(c, 'lang', typeof body.lang === 'string' ? body.lang.trim() : body.lang);
  if ('source_lang' in body && body.source_lang !== null) {
    out.source_lang = supportedLanguage(c, 'source_lang', typeof body.source_lang === 'string' ? body.source_lang.trim() : body.source_lang);
  }
  c.throwIfAny();
  return out;
}

export { SUPPORTED_LANGUAGES };
