import { describe, expect, it } from 'vitest';
import type { Deal, SiteId } from '@/lib/types';
import { groupDeals, groupKey, indexGroupsByDealId, normalizeBrand, normalizeProductName } from '@/lib/group';

// 기준 시각: 2026-11-27 21:00 KST
const NOW = new Date('2026-11-27T21:00:00+09:00');

function deal(siteId: SiteId, productId: string, over: Partial<Deal> = {}): Deal {
  return {
    id: `${siteId}:${productId}`,
    siteId,
    name: '울 블렌드 더플 코트',
    brand: '브랜드',
    url: `https://example.com/${siteId}/${productId}`,
    imageUrl: null,
    originalPrice: 200000,
    salePrice: 100000,
    discountRate: 50,
    displayedDiscountRate: null,
    endsAt: '2026-11-30T23:59:00+09:00',
    endsAtSource: 'product',
    eventName: null,
    eventUrl: null,
    gender: 'women',
    theme: 'outer',
    soldOut: false,
    crawledAt: '2026-11-27T20:00:00+09:00',
    ...over,
  };
}

describe('normalizeBrand', () => {
  it('소문자로 바꾸고 공백·특수문자를 없앤다', () => {
    expect(normalizeBrand('  The North-Face® ')).toBe('thenorthface');
    expect(normalizeBrand('디미트리 블랙')).toBe('디미트리블랙');
  });

  it('전각 문자를 반각으로 맞춘다', () => {
    expect(normalizeBrand('ＮＩＫＥ')).toBe('nike');
  });

  it('브랜드가 없으면 빈 문자열', () => {
    expect(normalizeBrand(null)).toBe('');
    expect(normalizeBrand('  ')).toBe('');
  });
});

describe('normalizeProductName', () => {
  it('소문자로 바꾸고 공백·특수문자·이모지를 없앤다', () => {
    expect(normalizeProductName('Toggle Reversible  Mustang!! ☃️')).toBe('togglereversiblemustang');
  });

  it('색상 표기를 없앤다 (한글·영문)', () => {
    expect(normalizeProductName('울 더플 코트 블랙')).toBe('울더플코트');
    expect(normalizeProductName('Wool Coat_Black')).toBe('woolcoat');
    expect(normalizeProductName('울 더플 코트 (아이보리/차콜)')).toBe('울더플코트');
  });

  it('색상 앞의 밝기 표기는 색상과 함께 없앤다', () => {
    expect(normalizeProductName('Mustang_Dark brown')).toBe('mustang');
    expect(normalizeProductName('무스탕 다크 브라운')).toBe('무스탕');
  });

  it('색상이 뒤따르지 않는 밝기 표기는 상품명의 일부로 남긴다', () => {
    expect(normalizeProductName('라이트 다운 자켓')).toBe('라이트다운자켓');
    expect(normalizeProductName('Light Down Jacket')).toBe('lightdownjacket');
  });

  it('색상 글자가 다른 낱말 안에 들어 있으면 건드리지 않는다', () => {
    expect(normalizeProductName('블랙진 와이드 팬츠')).toBe('블랙진와이드팬츠');
    expect(normalizeProductName('Redwing Boots')).toBe('redwingboots');
  });

  it('사이즈 표기를 없앤다', () => {
    expect(normalizeProductName('후드 집업 XL')).toBe('후드집업');
    expect(normalizeProductName('후드 집업 [FREE]')).toBe('후드집업');
    expect(normalizeProductName('후드 집업 S/M/L')).toBe('후드집업');
  });

  it('색상 개수 표기를 없앤다', () => {
    expect(normalizeProductName('미드웨이트 패딩_5 COLOR')).toBe('미드웨이트패딩');
    expect(normalizeProductName('Basic Logo Hoodie (6color)')).toBe('basiclogohoodie');
    expect(normalizeProductName('리버시블 블루종 7컬러')).toBe('리버시블블루종');
  });

  it('모델 번호 같은 숫자는 남긴다', () => {
    expect(normalizeProductName('에어 포스 1 07 [FQ8901-259]')).toBe('에어포스107fq8901259');
    expect(normalizeProductName('다운자켓 7KF2027')).toBe('다운자켓7kf2027');
  });
});

describe('groupKey', () => {
  it('브랜드와 상품명을 정규화해 "브랜드|상품명"으로 만든다', () => {
    expect(groupKey({ brand: 'Sorano', name: 'Basic Logo Hoodie (6color)' })).toBe('sorano|basiclogohoodie');
  });

  it('색상·사이즈만 다른 상품은 같은 키', () => {
    const black = groupKey({ brand: '브랜드', name: '울 더플 코트 블랙 M' });
    const ivory = groupKey({ brand: '브랜드', name: '울 더플 코트_아이보리 (L)' });
    expect(black).toBe(ivory);
  });

  it('상품명 맨 앞에 붙은 브랜드명은 뺀다', () => {
    const withBrand = groupKey({ brand: '프릭스스토어', name: '프릭스스토어 나일론 플리스 블루종' });
    const without = groupKey({ brand: '프릭스스토어', name: '나일론 플리스 블루종' });
    expect(withBrand).toBe(without);
  });

  it('브랜드를 모르면 묶지 않는다 (null)', () => {
    expect(groupKey({ brand: null, name: '울 더플 코트' })).toBeNull();
    expect(groupKey({ brand: ' ', name: '울 더플 코트' })).toBeNull();
  });

  it('정규화하면 상품명이 남지 않을 때도 묶지 않는다 (null)', () => {
    expect(groupKey({ brand: '브랜드', name: '블랙 / 화이트' })).toBeNull();
    expect(groupKey({ brand: '브랜드', name: '브랜드' })).toBeNull();
  });

  it('브랜드가 다르면 상품명이 같아도 다른 키', () => {
    expect(groupKey({ brand: 'A', name: '코트' })).not.toBe(groupKey({ brand: 'B', name: '코트' }));
  });
});

describe('groupDeals', () => {
  it('같은 키가 2개 사이트 이상에 있을 때만 묶는다', () => {
    const groups = groupDeals(
      [
        deal('musinsa', '1'),
        deal('29cm', '1'),
        deal('musinsa', '2', { name: '혼자 있는 상품' }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('브랜드|울블렌드더플코트');
    expect(groups[0].offers.map((offer) => offer.deal.siteId).sort()).toEqual(['29cm', 'musinsa']);
  });

  it('한 사이트 안에서만 겹치는 상품은 묶지 않는다', () => {
    const groups = groupDeals(
      [deal('musinsa', '1', { name: '코트 블랙' }), deal('musinsa', '2', { name: '코트 아이보리' })],
      NOW,
    );
    expect(groups).toEqual([]);
  });

  it('브랜드를 모르는 상품은 묶지 않는다', () => {
    const groups = groupDeals([deal('musinsa', '1', { brand: null }), deal('29cm', '1', { brand: null })], NOW);
    expect(groups).toEqual([]);
  });

  it('사이트마다 가장 싼 것 하나만 남기고, 몇 개를 합쳤는지 센다', () => {
    const groups = groupDeals(
      [
        deal('musinsa', '1', { name: '코트 블랙', salePrice: 120000 }),
        deal('musinsa', '2', { name: '코트 아이보리', salePrice: 110000 }),
        deal('29cm', '1', { name: '코트', salePrice: 130000 }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    const musinsa = groups[0].offers.find((offer) => offer.deal.siteId === 'musinsa');
    expect(musinsa?.deal.id).toBe('musinsa:2');
    expect(musinsa?.variantCount).toBe(2);
    expect(groups[0].offers.find((offer) => offer.deal.siteId === '29cm')?.variantCount).toBe(1);
  });

  it('최저가와 가격 차이를 계산하고 최저가 사이트를 표시한다', () => {
    const [group] = groupDeals(
      [
        deal('musinsa', '1', { salePrice: 120000 }),
        deal('29cm', '1', { salePrice: 95000 }),
        deal('wconcept', '1', { salePrice: 110000 }),
      ],
      NOW,
    );
    expect(group.minSalePrice).toBe(95000);
    expect(group.maxSalePrice).toBe(120000);
    expect(group.priceGap).toBe(25000);
    expect(group.offers.map((offer) => [offer.deal.siteId, offer.isLowest])).toEqual([
      ['29cm', true],
      ['wconcept', false],
      ['musinsa', false],
    ]);
  });

  it('가격이 같은 최저가는 모두 표시한다', () => {
    const [group] = groupDeals([deal('musinsa', '1', { salePrice: 90000 }), deal('29cm', '1', { salePrice: 90000 })], NOW);
    expect(group.offers.every((offer) => offer.isLowest)).toBe(true);
    expect(group.priceGap).toBe(0);
  });

  it('품절은 최저가로 치지 않고 뒤로 보낸다', () => {
    const [group] = groupDeals(
      [
        deal('musinsa', '1', { salePrice: 80000, soldOut: true }),
        deal('29cm', '1', { salePrice: 95000 }),
        deal('wconcept', '1', { salePrice: 99000 }),
      ],
      NOW,
    );
    expect(group.minSalePrice).toBe(95000);
    expect(group.maxSalePrice).toBe(99000);
    expect(group.offers.map((offer) => [offer.deal.siteId, offer.isLowest])).toEqual([
      ['29cm', true],
      ['wconcept', false],
      ['musinsa', false],
    ]);
  });

  it('판매 중인 곳이 한 곳뿐이면 비교할 값이 없으니 최저가 표시를 하지 않는다', () => {
    const [group] = groupDeals(
      [deal('musinsa', '1', { salePrice: 50000 }), deal('29cm', '1', { salePrice: 70000, soldOut: true })],
      NOW,
    );
    expect(group.onSaleCount).toBe(1);
    expect(group.offers.some((offer) => offer.isLowest)).toBe(false);
    expect(group.minSalePrice).toBe(50000);
    expect(group.priceGap).toBe(0);
  });

  it('판매 중인 사이트 수를 센다', () => {
    const [group] = groupDeals(
      [
        deal('musinsa', '1', { salePrice: 80000, soldOut: true }),
        deal('29cm', '1', { salePrice: 95000 }),
        deal('wconcept', '1', { salePrice: 99000 }),
      ],
      NOW,
    );
    expect(group.onSaleCount).toBe(2);
  });

  it('한 사이트에 품절과 판매 중이 섞여 있으면 판매 중인 것을 고른다', () => {
    const [group] = groupDeals(
      [
        deal('musinsa', '1', { salePrice: 80000, soldOut: true }),
        deal('musinsa', '2', { salePrice: 90000 }),
        deal('29cm', '1', { salePrice: 95000 }),
      ],
      NOW,
    );
    expect(group.offers[0].deal.id).toBe('musinsa:2');
    expect(group.minSalePrice).toBe(90000);
  });

  it('모두 품절이면 최저가 표시를 하지 않고, 가격은 가장 싼 값으로 둔다', () => {
    const [group] = groupDeals(
      [deal('musinsa', '1', { salePrice: 80000, soldOut: true }), deal('29cm', '1', { salePrice: 95000, soldOut: true })],
      NOW,
    );
    expect(group.offers.some((offer) => offer.isLowest)).toBe(false);
    expect(group.minSalePrice).toBe(80000);
    expect(group.maxSalePrice).toBe(95000);
  });

  it('종료된 할인은 비교에서 뺀다', () => {
    const expired = '2026-11-27T20:00:00+09:00';
    expect(groupDeals([deal('musinsa', '1', { endsAt: expired }), deal('29cm', '1')], NOW)).toEqual([]);
  });

  it('가격 차이가 큰 묶음부터 돌려준다', () => {
    const groups = groupDeals(
      [
        deal('musinsa', 'a', { name: '니트', salePrice: 50000 }),
        deal('29cm', 'a', { name: '니트', salePrice: 52000 }),
        deal('musinsa', 'b', { name: '패딩', salePrice: 200000 }),
        deal('29cm', 'b', { name: '패딩', salePrice: 150000 }),
      ],
      NOW,
    );
    expect(groups.map((group) => group.priceGap)).toEqual([50000, 2000]);
  });

  it('묶음의 대표 이름·브랜드는 가장 앞선 사이트의 것, 이미지는 있는 것 중 가장 앞선 것', () => {
    const [group] = groupDeals(
      [
        deal('musinsa', '1', { name: '코트 블랙', brand: 'BRAND', salePrice: 120000, imageUrl: 'https://img/m.jpg' }),
        deal('29cm', '1', { name: '코트', brand: 'Brand', salePrice: 95000, imageUrl: null }),
      ],
      NOW,
    );
    expect(group.name).toBe('코트');
    expect(group.brand).toBe('Brand');
    expect(group.imageUrl).toBe('https://img/m.jpg');
  });

  it('묶음에 속한 모든 상품 id를 담는다 (사이트별 대표가 아닌 것도)', () => {
    const [group] = groupDeals(
      [
        deal('musinsa', '1', { name: '코트 블랙', salePrice: 120000 }),
        deal('musinsa', '2', { name: '코트 아이보리', salePrice: 110000 }),
        deal('29cm', '1', { name: '코트' }),
      ],
      NOW,
    );
    expect([...group.memberIds].sort()).toEqual(['29cm:1', 'musinsa:1', 'musinsa:2']);
  });

  it('받은 배열과 Deal을 바꾸지 않는다', () => {
    const input = [deal('musinsa', '1', { salePrice: 120000 }), deal('29cm', '1', { salePrice: 95000 })];
    const snapshot = JSON.stringify(input);
    groupDeals(input, NOW);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('3,000개도 금방 묶는다', () => {
    const many: Deal[] = [];
    for (let i = 0; i < 3000; i += 1) {
      many.push(deal(i % 2 === 0 ? 'musinsa' : '29cm', String(i), { name: `상품 ${Math.floor(i / 2)}` }));
    }
    const started = performance.now();
    const groups = groupDeals(many, NOW);
    expect(groups).toHaveLength(1500);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('indexGroupsByDealId', () => {
  it('상품 id로 그 상품이 속한 묶음을 찾는다', () => {
    const groups = groupDeals(
      [deal('musinsa', '1'), deal('29cm', '1'), deal('musinsa', '2', { name: '혼자 있는 상품' })],
      NOW,
    );
    const index = indexGroupsByDealId(groups);
    expect(index.get('musinsa:1')).toBe(groups[0]);
    expect(index.get('29cm:1')).toBe(groups[0]);
    expect(index.has('musinsa:2')).toBe(false);
  });
});
