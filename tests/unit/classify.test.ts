import { describe, expect, it } from 'vitest';

import {
  BROAD_TOP_CATEGORY_KEYWORDS,
  FALSE_FRIEND_WORDS,
  GENDER_CODES,
  GENDER_KEYWORDS,
  NON_CLOTHING_CATEGORY_KEYWORDS,
  PACK_KEYWORDS,
  THEME_KEYWORDS,
  classifyGender,
  classifyTheme,
} from '@/lib/classify';
import { GENDERS, THEMES } from '@/lib/types';
import type { Gender, Theme } from '@/lib/types';

/** Real Musinsa product names, as returned by the Musinsa adapter. */
const MUSINSA_PADDING = '[10주년기획] © 모두의 Comfortemp® 미드웨이트 패딩_5 COLOR';
const MUSINSA_FLEECE_ZIP_UP = '2WAY 웨이브 플리스 후드 집업_4 COLOR';
const MUSINSA_CHELSEA_BOOTS = '라운드 로우 컷 인젝션 첼시 부츠 [다크 브라운]';
const MUSINSA_SOCKS = '[3PACK] 1507 클래식 트라우져 하이 루즈 삭스 _ 스노우화이트/크림';

/** A name without any gender or theme wording. */
const PLAIN_NAME = '베이직 로고 에디션 [블랙]';

type GenderCase = [rawGender: string | null | undefined, expected: Gender];
type NameGenderCase = [name: string, expected: Gender];
type CategoryThemeCase = [rawCategory: string, expected: Theme];
type NameThemeCase = [name: string, expected: Theme];

describe('classifyGender: site-provided rawGender comes first', () => {
  it.each<GenderCase>([
    ['남성', 'men'],
    ['여성', 'women'],
    ['남녀공용', 'unisex'],
  ])('maps the real Musinsa value %j to %s', (rawGender, expected) => {
    expect(classifyGender(rawGender, null, PLAIN_NAME)).toBe(expected);
  });

  it.each<GenderCase>([
    ['WOMEN', 'women'],
    ['MEN', 'men'],
    ['women', 'women'],
    ["Women's", 'women'],
    ['MENS', 'men'],
    ['WOMAN', 'women'],
    ['MAN', 'men'],
    ['FEMALE', 'women'],
    ['MALE', 'men'],
    ['우먼', 'women'],
    ['우먼즈', 'women'],
    ['맨즈', 'men'],
    ['맨', 'men'],
    ['여성용', 'women'],
    ['남성용', 'men'],
    ['유니섹스', 'unisex'],
    ['UNISEX', 'unisex'],
    ['공용', 'unisex'],
    ['  여성  ', 'women'],
  ])('maps the wording %j to %s', (rawGender, expected) => {
    expect(classifyGender(rawGender, null, PLAIN_NAME)).toBe(expected);
  });

  it.each<GenderCase>([
    ['F', 'women'],
    ['W', 'women'],
    ['M', 'men'],
    ['m', 'men'],
    ['A', 'unisex'],
    ['ALL', 'unisex'],
  ])('accepts the bare code %j when it is the whole value', (rawGender, expected) => {
    expect(classifyGender(rawGender, null, PLAIN_NAME)).toBe(expected);
  });

  it('does not read WOMEN as men although the word contains MEN', () => {
    expect(classifyGender('WOMEN', null, PLAIN_NAME)).not.toBe('men');
    expect(classifyGender('WOMEN', null, PLAIN_NAME)).not.toBe('unisex');
  });

  it('returns unisex when the site value names both men and women', () => {
    expect(classifyGender('MEN/WOMEN', null, PLAIN_NAME)).toBe('unisex');
    expect(classifyGender('남성, 여성', null, PLAIN_NAME)).toBe('unisex');
  });

  it('prefers the site value over a conflicting category and name', () => {
    expect(classifyGender('여성', '남성 > 아우터', '남성 오버핏 코트')).toBe('women');
  });

  it.each<GenderCase>([
    ['키즈', 'unclassified'],
    ['KIDS', 'unclassified'],
    ['아동', 'unclassified'],
  ])('treats the kids value %j as out of scope whatever the name says', (rawGender, expected) => {
    expect(classifyGender(rawGender, null, '여성 숏패딩')).toBe(expected);
  });

  it('falls through to the category when the site value is not recognised', () => {
    expect(classifyGender('기타', '여성 > 아우터', PLAIN_NAME)).toBe('women');
    expect(classifyGender('', '남성 > 상의', PLAIN_NAME)).toBe('men');
  });
});

describe('classifyGender: gender words inside rawCategory come second', () => {
  it.each<[string, Gender]>([
    ['여성 > 아우터 > 패딩', 'women'],
    ['남성 > 상의 > 맨투맨', 'men'],
    ['WOMEN > OUTER > COAT', 'women'],
    ['MEN > BOTTOM', 'men'],
    ['남성의류 > 하의', 'men'],
    ['여성의류/원피스', 'women'],
    ['남녀공용 > 신발', 'unisex'],
    ['유니섹스 > 가방', 'unisex'],
    ['키즈 > 여아 > 아우터', 'unclassified'],
  ])('reads %j as %s', (rawCategory, expected) => {
    expect(classifyGender(null, rawCategory, PLAIN_NAME)).toBe(expected);
  });

  it('prefers the category over the product name', () => {
    expect(classifyGender(null, '여성 > 니트', '남성 케이블 니트')).toBe('women');
  });

  it('does not treat a single letter inside the category as a gender code', () => {
    expect(classifyGender(null, 'W > 아우터', PLAIN_NAME)).toBe('unclassified');
  });

  it('does not read the category 맨투맨 as men', () => {
    expect(classifyGender(null, '상의 > 맨투맨', PLAIN_NAME)).toBe('unclassified');
  });

  it('falls through to the name when the category has no gender word', () => {
    expect(classifyGender(null, '아우터', '여성 울 코트')).toBe('women');
  });
});

describe('classifyGender: product-name keywords come last', () => {
  it.each<NameGenderCase>([
    ['여성 울 블렌드 코트', 'women'],
    ['남성 헤비 코튼 후드', 'men'],
    ['여성용 기모 레깅스', 'women'],
    ['남성용 드로즈 3팩', 'men'],
    ['우먼즈 크롭 니트', 'women'],
    ['맨즈 카고 팬츠', 'men'],
    ['유니섹스 오버핏 후드티', 'unisex'],
    ['[남녀공용] 헤비 맨투맨', 'unisex'],
    ['남성 여성 커플 파자마', 'unisex'],
    ["WOMEN'S CABLE KNIT CARDIGAN", 'women'],
    ['MENS WOOL BALMACAAN COAT', 'men'],
    ['UNISEX LOGO HOODIE', 'unisex'],
    ['WOMEN용 숏 패딩', 'women'],
  ])('reads %j as %s', (name, expected) => {
    expect(classifyGender(null, null, name)).toBe(expected);
  });

  it.each<NameGenderCase>([
    ['오버핏 맨투맨', 'unclassified'],
    ['오버핏 티셔츠 M', 'unclassified'],
    ['W 로고 볼캡', 'unclassified'],
    ['F/W 울 코트', 'unclassified'],
    ['IRON MAN 그래픽 티셔츠', 'unclassified'],
    ['남자친구 선물 캐시미어 머플러', 'unclassified'],
    ['키즈 덕다운 패딩', 'unclassified'],
    ['주니어 여아 원피스', 'unclassified'],
    [MUSINSA_PADDING, 'unclassified'],
    [MUSINSA_SOCKS, 'unclassified'],
    [PLAIN_NAME, 'unclassified'],
    ['', 'unclassified'],
  ])('does not guess a gender for %j', (name, expected) => {
    expect(classifyGender(null, null, name)).toBe(expected);
  });

  it('accepts undefined site values', () => {
    expect(classifyGender(undefined, undefined, '여성 니트')).toBe('women');
    expect(classifyGender(undefined, undefined, PLAIN_NAME)).toBe('unclassified');
  });

  it('classifies the real Musinsa rows by their rawGender', () => {
    expect(classifyGender('남녀공용', '아우터', MUSINSA_PADDING)).toBe('unisex');
    expect(classifyGender('남성', '신발', MUSINSA_CHELSEA_BOOTS)).toBe('men');
    expect(classifyGender('여성', '소품', MUSINSA_SOCKS)).toBe('women');
    expect(classifyGender(null, '아우터', MUSINSA_FLEECE_ZIP_UP)).toBe('unclassified');
  });
});

describe('classifyTheme: site category comes first', () => {
  it.each<CategoryThemeCase>([
    ['아우터', 'outer'],
    ['상의', 'top'],
    ['바지', 'bottom'],
    ['신발', 'shoes'],
    ['원피스/스커트', 'dress'],
    ['가방', 'bag_acc'],
    ['소품', 'bag_acc'],
  ])('maps the real Musinsa category %j to %s', (rawCategory, expected) => {
    expect(classifyTheme(rawCategory, PLAIN_NAME)).toBe(expected);
  });

  it.each<CategoryThemeCase>([
    ['여성 > 아우터 > 패딩', 'outer'],
    ['WOMEN > OUTER > COAT', 'outer'],
    ['자켓/점퍼', 'outer'],
    ['남성 > 상의 > 맨투맨/후드', 'top'],
    ['TOP', 'top'],
    ['셔츠/블라우스', 'top'],
    ['상의 > 니트/스웨터', 'knit'],
    ['KNIT', 'knit'],
    ['가디건', 'knit'],
    ['하의', 'bottom'],
    ['팬츠 > 데님', 'bottom'],
    ['슬랙스', 'bottom'],
    ['BOTTOM', 'bottom'],
    ['DRESS', 'dress'],
    ['Skirts', 'dress'],
    ['셋업', 'setup'],
    ['수트/세트', 'setup'],
    ['SHOES', 'shoes'],
    ['슈즈 > 스니커즈', 'shoes'],
    ['신발 > 부츠', 'shoes'],
    ['패션잡화 > 양말', 'bag_acc'],
    ['액세서리', 'bag_acc'],
    ['ACC', 'bag_acc'],
    ['모자', 'bag_acc'],
    ['머플러/벨트/지갑', 'bag_acc'],
    ['이너', 'inner_home'],
    ['속옷/홈웨어', 'inner_home'],
    ['언더웨어', 'inner_home'],
    ['파자마/잠옷', 'inner_home'],
  ])('maps the category %j to %s', (rawCategory, expected) => {
    expect(classifyTheme(rawCategory, PLAIN_NAME)).toBe(expected);
  });

  it.each<CategoryThemeCase>([
    ['뷰티', 'etc'],
    ['디지털/라이프', 'etc'],
    ['라이프', 'etc'],
    ['스포츠용품', 'etc'],
    ['키즈', 'etc'],
    ['BEAUTY > SKINCARE', 'etc'],
    ['뷰티 > 바디 > 세트', 'etc'],
  ])('puts the non-clothing bucket %j into etc', (rawCategory, expected) => {
    expect(classifyTheme(rawCategory, '시그니처 기프트 세트')).toBe(expected);
  });

  it('prefers the category over a conflicting name', () => {
    expect(classifyTheme('아우터', '데님 팬츠')).toBe('outer');
    expect(classifyTheme('신발', '울 코트')).toBe('shoes');
  });

  it('does not read 디자이너 as the 이너 bucket', () => {
    expect(classifyTheme('디자이너', PLAIN_NAME)).toBe('unclassified');
  });

  it('falls back to the name when the category is not recognised', () => {
    expect(classifyTheme('스포츠/레저', '경량 패딩 자켓')).toBe('outer');
    expect(classifyTheme('기획전', '와이드 데님 팬츠')).toBe('bottom');
    expect(classifyTheme('', '케이블 니트')).toBe('knit');
  });

  it('returns unclassified when neither the category nor the name is recognised', () => {
    expect(classifyTheme('기획전', PLAIN_NAME)).toBe('unclassified');
    expect(classifyTheme(null, PLAIN_NAME)).toBe('unclassified');
    expect(classifyTheme(undefined, '')).toBe('unclassified');
  });
});

describe('classifyTheme: broad top category refined by a knitwear name', () => {
  it.each<string>(['케이블 니트', '울 브이넥 가디건', '램스울 크루넥 스웨터', 'CABLE KNIT SWEATER'])(
    'returns knit for the category 상의 and the name %j',
    (name) => {
      expect(classifyTheme('상의', name)).toBe('knit');
    },
  );

  it('applies the same refinement to the Latin TOP bucket', () => {
    expect(classifyTheme('TOP', '모헤어 가디건')).toBe('knit');
  });

  it('keeps top when the name does not say knitwear', () => {
    expect(classifyTheme('상의', '헤비 코튼 반팔 티셔츠')).toBe('top');
  });

  it('keeps top when the category already names a specific top sub-bucket', () => {
    expect(classifyTheme('상의 > 셔츠/블라우스', '니트 카라 셔츠')).toBe('top');
  });

  it('does not refine other categories from the name', () => {
    expect(classifyTheme('아우터', '니트 집업 가디건')).toBe('outer');
  });
});

describe('classifyTheme: product-name keywords when the category is missing', () => {
  it.each<NameThemeCase>([
    ['패딩 조끼', 'outer'],
    ['니트 원피스', 'dress'],
    ['데님 자켓', 'outer'],
    ['슬랙스 셋업', 'setup'],
    ['후드 집업', 'outer'],
    ['숏패딩', 'outer'],
    ['첼시 부츠', 'shoes'],
    ['트라우져 삭스', 'bag_acc'],
  ])('lets the product noun win in %j -> %s', (name, expected) => {
    expect(classifyTheme(null, name)).toBe(expected);
  });

  it.each<NameThemeCase>([
    ['울 블렌드 싱글 코트', 'outer'],
    ['구스다운 롱패딩', 'outer'],
    ['나일론 바람막이 점퍼', 'outer'],
    ['WOOL HALF COAT_BLACK', 'outer'],
    ['FLEECE HOOD ZIP-UP', 'outer'],
    ['헤비 코튼 후드 티셔츠', 'top'],
    ['오버핏 맨투맨', 'top'],
    ['스트라이프 옥스포드 셔츠', 'top'],
    ['프릴 블라우스', 'top'],
    ['데님 셔츠', 'top'],
    ['GRAPHIC T-SHIRT', 'top'],
    ['케이블 니트', 'knit'],
    ['모헤어 가디건', 'knit'],
    ['램스울 스웨터', 'knit'],
    ['니트 조끼', 'knit'],
    ['와이드 데님 팬츠', 'bottom'],
    ['핀턱 와이드 슬랙스', 'bottom'],
    ['니트 팬츠', 'bottom'],
    ['부츠컷 데님', 'bottom'],
    ['수트 팬츠', 'bottom'],
    ['WIDE DENIM PANTS', 'bottom'],
    ['플리츠 미디 스커트', 'dress'],
    ['셔츠 원피스', 'dress'],
    ['데님 스커트', 'dress'],
    ['자켓 팬츠 세트', 'setup'],
    ['트레이닝 수트', 'setup'],
    ['TWEED SET-UP', 'setup'],
    ['레더 스니커즈', 'shoes'],
    ['패딩 부츠', 'shoes'],
    ['페니 로퍼', 'shoes'],
    ['CHELSEA BOOTS', 'shoes'],
    ['캐시미어 머플러', 'bag_acc'],
    ['니트 비니', 'bag_acc'],
    ['레더 벨트', 'bag_acc'],
    ['카드 지갑', 'bag_acc'],
    ['나일론 백팩', 'bag_acc'],
    ['코튼 볼캡', 'bag_acc'],
    ['스니커즈 양말', 'bag_acc'],
    ['LEATHER TOTE BAG', 'bag_acc'],
    ['코튼 파자마', 'inner_home'],
    ['심리스 속옷', 'inner_home'],
    ['수면 잠옷', 'inner_home'],
  ])('classifies %j as %s', (name, expected) => {
    expect(classifyTheme(null, name)).toBe(expected);
  });

  it.each<NameThemeCase>([
    ['양말 5켤레 세트', 'bag_acc'],
    ['코튼 파자마 세트', 'inner_home'],
    ['머플러 장갑 세트', 'bag_acc'],
  ])('does not let a pack word turn %j into a setup', (name, expected) => {
    expect(classifyTheme(null, name)).toBe(expected);
  });

  it.each<NameThemeCase>([
    ['핀턱 와이드 슬랙스 (벨트 포함)', 'bottom'],
    ['트렌치 코트 [벨트 세트]', 'outer'],
    ['라운드 첼시 부츠 [데님 블루]', 'shoes'],
  ])('ignores bracketed option text in %j', (name, expected) => {
    expect(classifyTheme(null, name)).toBe(expected);
  });

  it('still reads a bracket when nothing outside it matches', () => {
    expect(classifyTheme(null, '시그니처 에디션 [패딩]')).toBe('outer');
  });

  it.each<NameThemeCase>([
    ['다크 브라운 컬러 에디션', 'unclassified'],
    ['알파카 100% 에디션', 'unclassified'],
    ['BAGGY FIT EDITION', 'unclassified'],
    ['LAPTOP STAND', 'unclassified'],
    ['오프숄더 에디션', 'unclassified'],
    [PLAIN_NAME, 'unclassified'],
  ])('does not guess a theme for %j', (name, expected) => {
    expect(classifyTheme(null, name)).toBe(expected);
  });

  it('does not read the 파카 inside 알파카 as a parka', () => {
    expect(classifyTheme(null, '알파카 니트')).toBe('knit');
    expect(classifyTheme(null, '피쉬테일 파카')).toBe('outer');
  });

  it('never returns etc from a name alone', () => {
    expect(classifyTheme(null, '뷰티 기프트 박스')).toBe('unclassified');
  });
});

describe('classifyTheme: real Musinsa names', () => {
  it.each<[string, string, Theme]>([
    ['아우터', MUSINSA_PADDING, 'outer'],
    ['아우터', MUSINSA_FLEECE_ZIP_UP, 'outer'],
    ['신발', MUSINSA_CHELSEA_BOOTS, 'shoes'],
    ['소품', MUSINSA_SOCKS, 'bag_acc'],
  ])('classifies category %j + %j as %s', (rawCategory, name, expected) => {
    expect(classifyTheme(rawCategory, name)).toBe(expected);
  });

  it.each<NameThemeCase>([
    [MUSINSA_PADDING, 'outer'],
    [MUSINSA_FLEECE_ZIP_UP, 'outer'],
    [MUSINSA_CHELSEA_BOOTS, 'shoes'],
    [MUSINSA_SOCKS, 'bag_acc'],
  ])('classifies %j from the name alone as %s', (name, expected) => {
    expect(classifyTheme(null, name)).toBe(expected);
  });
});

describe('keyword tables', () => {
  it('has a keyword set for every clothing theme and none for etc/unclassified', () => {
    const expected = THEMES.filter((theme) => theme !== 'etc' && theme !== 'unclassified');
    expect(Object.keys(THEME_KEYWORDS).sort()).toEqual([...expected].sort());
  });

  it('has a keyword set for every gender signal', () => {
    expect(Object.keys(GENDER_KEYWORDS).sort()).toEqual(['kids', 'men', 'unisex', 'women']);
  });

  it('keeps every keyword lower-case, trimmed and non-empty', () => {
    const all = [
      ...Object.values(THEME_KEYWORDS).flatMap((set) => [...set.anywhere, ...set.wholeWord]),
      ...Object.values(GENDER_KEYWORDS).flatMap((set) => [
        ...set.anywhere,
        ...set.wholeWord,
        ...set.siteOnly,
      ]),
      ...NON_CLOTHING_CATEGORY_KEYWORDS.anywhere,
      ...NON_CLOTHING_CATEGORY_KEYWORDS.wholeWord,
      ...BROAD_TOP_CATEGORY_KEYWORDS,
      ...PACK_KEYWORDS,
      ...FALSE_FRIEND_WORDS,
      ...GENDER_CODES.keys(),
    ];
    for (const keyword of all) {
      expect(keyword.length, `keyword "${keyword}"`).toBeGreaterThan(0);
      expect(keyword, `keyword "${keyword}"`).toBe(keyword.trim().toLowerCase());
    }
  });

  it('keeps Latin keywords out of the substring lists', () => {
    const substringKeywords = [
      ...Object.values(THEME_KEYWORDS).flatMap((set) => set.anywhere),
      ...Object.values(GENDER_KEYWORDS).flatMap((set) => set.anywhere),
      ...NON_CLOTHING_CATEGORY_KEYWORDS.anywhere,
    ];
    for (const keyword of substringKeywords) {
      expect(/[a-z]/.test(keyword), `keyword "${keyword}"`).toBe(false);
    }
  });

  it('does not list the same theme keyword under two themes', () => {
    const all = Object.values(THEME_KEYWORDS).flatMap((set) => [...set.anywhere, ...set.wholeWord]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('maps every gender code to a known gender', () => {
    for (const gender of GENDER_CODES.values()) {
      expect(GENDERS).toContain(gender);
    }
  });
});

describe('purity', () => {
  it('returns the same answer on repeated calls', () => {
    const first = classifyTheme('상의', '케이블 니트');
    const second = classifyTheme('상의', '케이블 니트');
    expect(second).toBe(first);
    expect(classifyGender('WOMEN', null, PLAIN_NAME)).toBe('women');
    expect(classifyGender('WOMEN', null, PLAIN_NAME)).toBe('women');
  });
});
