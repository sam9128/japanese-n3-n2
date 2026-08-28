// Does this string look like Chinese prose that has leaked into a Japanese field?
//
// It lives here because the generator and validate-content both need it and used
// to hold their own copy, which is the same shape of bug as the two disagreeing
// unlock caps: one of the pair gets narrowed and the other does not.
//
// The rule has been narrowed twice by the same discovery — a blacklist of
// characters and words keeps meeting real Japanese. 個 and 該 went first (数個,
// 該当), then 這 (這う, to crawl) and the phrase 答案 (とうあん, an exam paper)
// when the word list was rebuilt from the JLPT list. So it now tests shape
// rather than membership:
//
//   * kana exempts a string outright — Chinese has none, so anything containing
//     it is Japanese whatever kanji it also uses;
//   * the phrase list applies only to something long enough to be prose. A
//     two-kanji option is a word, and words are what the blacklist collides with.
const CHINESE_ONLY = /[裡讓應嗎們]/;
const CHINESE_PROSE = /下午|上午|二樓|選項|答案|中文|直接放棄|身邊的人/;
const PROSE_LENGTH = 5;

export function hasChineseMarker(value) {
  const text = value || "";
  if (/[぀-ゟ゠-ヿ]/.test(text)) return false;
  return CHINESE_ONLY.test(text) || (text.length >= PROSE_LENGTH && CHINESE_PROSE.test(text));
}
