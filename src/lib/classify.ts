/**
 * Rule-based gender and theme classification (constitution IV, research R8).
 *
 * Precedence, both classifiers: site-provided value -> product-name keywords -> 'unclassified'.
 *  - classifyGender: rawGender, then gender words inside rawCategory, then the product name.
 *  - classifyTheme: rawCategory, then the product name.
 *
 * How a keyword is matched (text is NFKC-normalised and lower-cased first):
 *  - `anywhere`  Hangul words matched as substrings ('여성용' contains '여성').
 *  - `wholeWord` matched only as a complete word. Every Latin keyword belongs here ('women'
 *    contains 'men', 'baggy' contains 'bag'); an optional plural "s" is accepted and a space also
 *    matches "-" or nothing ('zip up' = 'zip-up' = 'zipup'). Short Hangul words that hide inside
 *    other words go here too ('이너' in '디자이너', '브라' in '브라운').
 *
 * Which theme keyword wins when several match:
 *  1. A keyword inside a longer matched keyword is dropped ('부츠' in '부츠컷').
 *  2. Pack words ('세트') are dropped when a shoes / accessory / innerwear keyword also matched
 *     ('양말 5켤레 세트' is socks, not a setup).
 *  3. The keyword that ends last wins. Product names put the product noun last ('데님 자켓' is a
 *     jacket, '트라우져 삭스' is socks) and the deepest segment of a category path is the most
 *     specific one ('상의 > 니트/스웨터').
 *  Bracketed option text ('[다크 브라운]', '(벨트 포함)') is read only when nothing else matches.
 */
import { THEMES } from '@/lib/types';
import type { Gender, Theme } from '@/lib/types';

export interface KeywordSet {
  /** Hangul words that are safe to match as substrings. */
  readonly anywhere: readonly string[];
  /** Words that count only as a complete word (all Latin words, short Hangul words). */
  readonly wholeWord: readonly string[];
}

export interface GenderKeywordSet extends KeywordSet {
  /** Whole words trusted only in rawGender / rawCategory, never in a product name. */
  readonly siteOnly: readonly string[];
}

export type GenderSignal = 'women' | 'men' | 'unisex' | 'kids';
export type ClothingTheme = Exclude<Theme, 'etc' | 'unclassified'>;

// ---------- Keyword tables (extend these, not the functions) ----------

/**
 * 'kids' is out of scope and ends as 'unclassified'. '맨' is site-only because of '맨투맨', and
 * 'man' / 'woman' because of graphic titles such as "IRON MAN".
 */
export const GENDER_KEYWORDS: Readonly<Record<GenderSignal, GenderKeywordSet>> = {
  women: {
    anywhere: ['여성', '여자', '우먼', '위민', '레이디'],
    wholeWord: ['women', 'ladies'],
    siteOnly: ['woman', 'female', 'lady', 'femme'],
  },
  men: {
    anywhere: ['남성', '남자', '맨즈', '멘즈'],
    wholeWord: ['men'],
    siteOnly: ['man', 'male', 'homme', '맨'],
  },
  unisex: {
    anywhere: ['남녀공용', '유니섹스', '남녀', '젠더리스'],
    wholeWord: ['unisex', 'genderless'],
    siteOnly: ['공용'],
  },
  kids: {
    anywhere: ['키즈', '아동', '유아', '주니어', '토들러', '남아', '여아'],
    wholeWord: ['kids', 'junior', 'toddler', 'boys', 'girls'],
    siteOnly: ['kid', 'baby', '베이비'],
  },
};

/** Codes that count only as the entire rawGender value (product names contain sizes like 'M'). */
export const GENDER_CODES: ReadonlyMap<string, Gender> = new Map<string, Gender>([
  ['m', 'men'],
  ['w', 'women'],
  ['f', 'women'],
  ['a', 'unisex'],
  ['u', 'unisex'],
  ['all', 'unisex'],
  ['남', 'men'],
  ['여', 'women'],
]);

/** Words that contain a keyword but say nothing about gender or theme; removed before matching. */
export const FALSE_FRIEND_WORDS: readonly string[] = ['알파카', '남자친구', '여자친구'];

export const THEME_KEYWORDS: Readonly<Record<ClothingTheme, KeywordSet>> = {
  outer: {
    anywhere: [
      '아우터', '자켓', '재킷', '코트', '패딩', '점퍼', '잠바', '집업', '블레이저', '블루종',
      '바람막이', '윈드브레이커', '야상', '무스탕', '플리스', '후리스', '파카', '트러커',
      '아노락', '덕다운', '구스다운',
    ],
    wholeWord: [
      'outer', 'outerwear', 'jacket', 'coat', 'padding', 'puffer', 'jumper', 'parka', 'blazer',
      'windbreaker', 'blouson', 'anorak', 'fleece', 'zip up',
    ],
  },
  top: {
    anywhere: [
      '상의', '티셔츠', '셔츠', '블라우스', '맨투맨', '후드', '후디', '반팔', '긴팔', '민소매',
      '나시', '슬리브리스', '롱슬리브', '탱크탑', '크롭탑', '튜브탑', '뷔스티에',
    ],
    wholeWord: [
      'top', 'tee', 'shirt', 'tshirt', 'blouse', 'sweatshirt', 'hoodie', 'hoody', 'hood', 'mtm',
      'sleeveless', 'long sleeve', '탑',
    ],
  },
  knit: {
    anywhere: ['니트', '스웨터', '가디건', '카디건', '풀오버'],
    wholeWord: ['knit', 'knitwear', 'knitted', 'sweater', 'cardigan', 'pullover'],
  },
  bottom: {
    anywhere: [
      '바지', '하의', '팬츠', '데님', '슬랙스', '슬렉스', '쇼츠', '숏츠', '레깅스', '조거',
      '트라우저', '트라우져', '부츠컷', '점프수트', '점프슈트',
    ],
    wholeWord: [
      'bottom', 'pants', 'denim', 'jeans', 'slacks', 'trouser', 'shorts', 'leggings', 'jogger',
      'bootcut', 'boot cut', 'jumpsuit',
    ],
  },
  dress: {
    anywhere: ['원피스', '스커트', '드레스', '치마'],
    wholeWord: ['dress', 'dresses', 'skirt', 'onepiece', 'one piece', 'ops'],
  },
  setup: {
    anywhere: ['셋업', '세트업', '수트', '슈트', '세트', '셋트', '투피스', '쓰리피스', '정장'],
    wholeWord: ['set up', 'suit', 'set'],
  },
  shoes: {
    anywhere: [
      '신발', '슈즈', '스니커즈', '스니커', '부츠', '운동화', '러닝화', '등산화', '구두', '로퍼',
      '샌들', '슬리퍼', '슬립온', '펌프스', '하이힐', '블로퍼', '플립플랍', '장화',
    ],
    wholeWord: [
      'shoe', 'sneaker', 'boot', 'loafer', 'sandal', 'slipper', 'heel', 'mule', 'slip on', 'pumps',
      'flats', 'footwear', '힐', '뮬',
    ],
  },
  bag_acc: {
    anywhere: [
      '가방', '소품', '잡화', '액세서리', '악세서리', '악세사리', '액세사리', '모자', '양말',
      '삭스', '머플러', '벨트', '지갑', '백팩', '토트백', '숄더백', '크로스백', '에코백', '미니백',
      '호보백', '버킷백', '메신저백', '더플백', '보스턴백', '웨이스트백', '힙색', '클러치',
      '파우치', '볼캡', '비니', '버킷햇', '스카프', '목도리', '장갑', '넥타이', '시계', '주얼리',
      '쥬얼리', '목걸이', '귀걸이', '반지', '팔찌', '선글라스', '안경', '키링', '워머',
      '바라클라바', '스타킹', '우산',
    ],
    wholeWord: [
      'bag', 'backpack', 'wallet', 'belt', 'cap', 'hat', 'beanie', 'sock', 'muffler', 'scarf',
      'glove', 'acc', 'accessory', 'accessories', 'necklace', 'earring', 'bracelet', 'sunglasses',
      'eyewear', 'pouch', 'clutch', 'keyring', 'jewelry', 'balaclava', 'stocking', 'tights', '캡',
    ],
  },
  inner_home: {
    anywhere: [
      '이너웨어', '언더웨어', '속옷', '홈웨어', '파자마', '잠옷', '브라렛', '브래지어', '팬티',
      '드로즈', '라운지웨어', '내복',
    ],
    wholeWord: [
      'inner', 'innerwear', 'underwear', 'homewear', 'pajama', 'pyjama', 'sleepwear', 'loungewear',
      'bra', 'bralette', 'panty', 'panties', 'briefs', 'lingerie', '이너', '브라',
    ],
  },
};

/** Category buckets that are not adult clothing. Checked on rawCategory only, before the themes. */
export const NON_CLOTHING_CATEGORY_KEYWORDS: KeywordSet = {
  anywhere: [
    '뷰티', '화장품', '라이프', '리빙', '디지털', '가전', '식품', '푸드', '스포츠용품', '키즈',
    '아동', '유아', '반려', '문구', '도서', '가구', '인테리어',
  ],
  wholeWord: [
    'beauty', 'cosmetic', 'life', 'lifestyle', 'living', 'digital', 'tech', 'food', 'kids', 'pet',
    'culture',
  ],
};

/** Category keywords that only name the broad top bucket; a knitwear name refines them to knit. */
export const BROAD_TOP_CATEGORY_KEYWORDS: readonly string[] = ['상의', 'top'];

/** "Sold as a pack" words: a setup only when no keyword of PACK_OVERRIDING_THEMES matched. */
export const PACK_KEYWORDS: readonly string[] = ['세트', '셋트', 'set'];
export const PACK_OVERRIDING_THEMES: readonly ClothingTheme[] = ['shoes', 'bag_acc', 'inner_home'];

// ---------- Text and pattern helpers ----------

const APOSTROPHES = /['’‘`]/g;
const BRACKETED_TEXT = /\[[^\]]*\]|\([^)]*\)|<[^>]*>|【[^】]*】/g;
const LATIN_KEYWORD = /^[a-z ]+$/;
const REGEXP_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const LATIN_LETTER = '[a-z]';
const HANGUL_SYLLABLE = '[가-힣]';
/** A space inside a Latin keyword also matches a hyphen or nothing. */
const LATIN_WORD_GAP = '[\\s-]?';
const LATIN_PLURAL_SUFFIX = 's?';
/** Source of a pattern that never matches (an empty alternation would match everything). */
const NEVER_MATCH = '(?!)';

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const lowered = value.normalize('NFKC').toLowerCase().replace(APOSTROPHES, '');
  return FALSE_FRIEND_WORDS.reduce((text, word) => text.split(word).join(' '), lowered);
}

function stripBracketed(text: string): string {
  return text.replace(BRACKETED_TEXT, ' ');
}

function escapeRegExp(keyword: string): string {
  return keyword.replace(REGEXP_SPECIAL_CHARS, '\\$&');
}

function wholeWordSource(keyword: string): string {
  const escaped = escapeRegExp(keyword);
  if (!LATIN_KEYWORD.test(keyword)) {
    return `(?<!${HANGUL_SYLLABLE})${escaped}(?!${HANGUL_SYLLABLE})`;
  }
  const words = escaped.replace(/ /g, LATIN_WORD_GAP);
  return `(?<!${LATIN_LETTER})${words}${LATIN_PLURAL_SUFFIX}(?!${LATIN_LETTER})`;
}

function keywordSources(set: KeywordSet): string[] {
  return [...set.anywhere.map(escapeRegExp), ...set.wholeWord.map(wholeWordSource)];
}

function anyOf(sources: readonly string[]): RegExp {
  return new RegExp(sources.length === 0 ? NEVER_MATCH : sources.join('|'));
}

// ---------- Gender ----------

type TextSource = 'site' | 'name';
type GenderMatcher = Readonly<Record<TextSource, RegExp>>;

function buildGenderMatcher(set: GenderKeywordSet): GenderMatcher {
  const nameSources = keywordSources(set);
  return {
    name: anyOf(nameSources),
    site: anyOf([...nameSources, ...set.siteOnly.map(wholeWordSource)]),
  };
}

const GENDER_MATCHERS: Readonly<Record<GenderSignal, GenderMatcher>> = {
  women: buildGenderMatcher(GENDER_KEYWORDS.women),
  men: buildGenderMatcher(GENDER_KEYWORDS.men),
  unisex: buildGenderMatcher(GENDER_KEYWORDS.unisex),
  kids: buildGenderMatcher(GENDER_KEYWORDS.kids),
};

/** null = this text says nothing about gender, so the next source is consulted. */
function genderFromText(text: string, source: TextSource): Gender | null {
  const has = (signal: GenderSignal): boolean => GENDER_MATCHERS[signal][source].test(text);
  if (has('kids')) return 'unclassified';
  const women = has('women');
  const men = has('men');
  if (has('unisex') || (women && men)) return 'unisex';
  if (women) return 'women';
  if (men) return 'men';
  return null;
}

/**
 * Gender of a product: rawGender first, then gender words in rawCategory, then the name.
 * Men and women together mean 'unisex'; kids wording and anything unknown mean 'unclassified'.
 */
export function classifyGender(
  rawGender: string | null | undefined,
  rawCategory: string | null | undefined,
  name: string,
): Gender {
  const siteGender = normalizeText(rawGender).trim();
  return (
    GENDER_CODES.get(siteGender) ??
    genderFromText(siteGender, 'site') ??
    genderFromText(normalizeText(rawCategory), 'site') ??
    genderFromText(normalizeText(name), 'name') ??
    'unclassified'
  );
}

// ---------- Theme ----------

interface ThemeMatcher {
  readonly keyword: string;
  readonly theme: ClothingTheme;
  /** Pattern source of this keyword. */
  readonly source: string;
}

interface KeywordHit {
  readonly keyword: string;
  readonly theme: ClothingTheme;
  readonly start: number;
  readonly end: number;
}

function isClothingTheme(theme: Theme): theme is ClothingTheme {
  return theme !== 'etc' && theme !== 'unclassified';
}

function buildThemeMatchers(theme: ClothingTheme): ThemeMatcher[] {
  const set = THEME_KEYWORDS[theme];
  return [
    ...set.anywhere.map((keyword) => ({ keyword, theme, source: escapeRegExp(keyword) })),
    ...set.wholeWord.map((keyword) => ({ keyword, theme, source: wholeWordSource(keyword) })),
  ];
}

/** Longest keyword first, so the scanner reports the longest keyword starting at a position. */
const THEME_MATCHERS: readonly ThemeMatcher[] = THEMES.filter(isClothingTheme)
  .flatMap(buildThemeMatchers)
  .sort((a, b) => b.keyword.length - a.keyword.length);

/**
 * One pass over the text instead of one per keyword: a zero-width lookahead with one capture group
 * per keyword, tried at every position. Shorter keywords starting at the same position are not
 * reported, which is what winner rule 1 would do with them anyway.
 */
const THEME_SCANNER = new RegExp(
  `(?=${THEME_MATCHERS.map((matcher) => `(${matcher.source})`).join('|') || NEVER_MATCH})`,
  'g',
);
const NON_CLOTHING_MATCHER = anyOf(keywordSources(NON_CLOTHING_CATEGORY_KEYWORDS));
const KNIT_MATCHER = anyOf(keywordSources(THEME_KEYWORDS.knit));

function toHit(found: RegExpExecArray): KeywordHit[] {
  const group = found.findIndex((captured, index) => index > 0 && captured !== undefined);
  const matcher = THEME_MATCHERS[group - 1];
  if (matcher === undefined) return [];
  const { keyword, theme } = matcher;
  return [{ keyword, theme, start: found.index, end: found.index + found[group].length }];
}

function findHits(text: string): KeywordHit[] {
  return Array.from(text.matchAll(THEME_SCANNER)).flatMap(toHit);
}

function isInsideLongerHit(hit: KeywordHit, hits: readonly KeywordHit[]): boolean {
  const length = hit.end - hit.start;
  return hits.some(
    (other) => other.start <= hit.start && other.end >= hit.end && other.end - other.start > length,
  );
}

function endsLater(hit: KeywordHit, best: KeywordHit): boolean {
  return hit.end > best.end || (hit.end === best.end && hit.start < best.start);
}

/** Applies winner rules 1-3 from the file header. */
function pickWinner(hits: readonly KeywordHit[]): KeywordHit | null {
  const standalone = hits.filter((hit) => !isInsideLongerHit(hit, hits));
  const packIsOverridden = standalone.some((hit) => PACK_OVERRIDING_THEMES.includes(hit.theme));
  const candidates = packIsOverridden
    ? standalone.filter((hit) => !PACK_KEYWORDS.includes(hit.keyword))
    : standalone;
  return candidates.reduce<KeywordHit | null>(
    (best, hit) => (best === null || endsLater(hit, best) ? hit : best),
    null,
  );
}

function findThemeHit(text: string): KeywordHit | null {
  if (text.trim() === '') return null;
  const withoutBrackets = stripBracketed(text);
  const winner = pickWinner(findHits(withoutBrackets));
  if (winner !== null || withoutBrackets === text) return winner;
  return pickWinner(findHits(text));
}

function isBroadTop(hit: KeywordHit): boolean {
  return hit.theme === 'top' && BROAD_TOP_CATEGORY_KEYWORDS.includes(hit.keyword);
}

/**
 * Theme of a product: rawCategory first ('etc' for non-clothing buckets), then the name, otherwise
 * 'unclassified'. A category that only says the broad top bucket becomes 'knit' when the name
 * says knitwear. A name alone never yields 'etc'.
 */
export function classifyTheme(rawCategory: string | null | undefined, name: string): Theme {
  const category = normalizeText(rawCategory);
  const productName = normalizeText(name);
  if (NON_CLOTHING_MATCHER.test(category)) return 'etc';

  const categoryHit = findThemeHit(category);
  if (categoryHit === null) return findThemeHit(productName)?.theme ?? 'unclassified';
  if (isBroadTop(categoryHit) && KNIT_MATCHER.test(stripBracketed(productName))) return 'knit';
  return categoryHit.theme;
}
