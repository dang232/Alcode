import { describe, expect, test } from 'bun:test';
import { activityI18n } from './activity.i18n';

const locales = [
  'en',
  'uk',
  'de',
  'fr',
  'es',
  'pt-BR',
  'nl',
  'pl',
  'tr',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW',
  'ar',
  'he',
] as const;

const KNOWN_COGNATES = new Set(['de:activity.view.code', 'fr:activity.view.code']);

describe('activity translations', () => {
  test('every locale has every key, translated', () => {
    const english = Object.entries(activityI18n.en);
    for (const locale of locales) {
      const dictionary = new Map<string, string>(Object.entries(activityI18n[locale]));
      expect([...dictionary.keys()].sort()).toEqual(english.map(([key]) => key).sort());
      for (const [key, englishText] of english) {
        expect(dictionary.get(key)?.trim()).toBeTruthy();
        if (locale !== 'en' && !KNOWN_COGNATES.has(`${locale}:${key}`)) {
          expect(`${locale} ${key}: ${dictionary.get(key)}`).not.toBe(`${locale} ${key}: ${englishText}`);
        }
      }
    }
  });
});
