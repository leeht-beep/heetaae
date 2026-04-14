# Market Resell Web MVP

Next.js + TypeScript + Tailwind CSS 기반의 반응형 웹 MVP입니다.

현재 상태:

- `mercari`: 실제 수집 provider 연결 완료
- `bunjang`: 실제 수집 provider 연결 완료
- `fruitsfamily`: 실제 수집 provider 연결 완료

기존 UI와 `search-service` 흐름은 유지한 채, 마켓별 provider를 실제 수집기로 단계적으로 교체할 수 있는 구조로 정리되어 있습니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 으로 접속하면 됩니다.

## 검증

```bash
npm run typecheck
npm run build
```

## 현재 구현 범위

- 3개 마켓 통합 검색 UI
- 추천 / 전체 / 판매중 / 판매완료 / 마켓별 탭
- 요약 카드, 평균가 비교, 거래량 추정, 추천 매입가 계산
- 추천 점수와 상세 모달
- provider별 상태 표시
- Mercari / Bunjang 실제 검색 결과 수집

## Provider 모드

`src/lib/config/provider-mode.ts`

- 기본 모드: `real`
- 지원 모드: `mock`, `real`
- API에서 `mode=mock` 또는 `mode=real` 쿼리 파라미터로 전환 가능
- 환경변수 `MARKET_PROVIDER_MODE=mock` 으로 전체 mock 모드로 되돌릴 수 있음

현재 `real` 모드에서는:

- `mercari`: real collector
- `bunjang`: real collector
- `fruitsfamily`: real collector

## 아키텍처 핵심

`src/lib/providers/base.ts`

- `RawMarketCollector`: raw collector response 반환
- `MarketNormalizer`: raw item을 공통 `MarketListing`으로 정규화
- `MarketDataSource`: collector + normalizer 조합
- `runMarketDataSource`: timeout, error, normalization, summary를 공통 처리

`src/lib/types/market.ts`

- `RawCollectorEnvelope`
- `NormalizationEnvelope`
- `MarketCollectionSummary`
- `MarketProviderResultSnapshot`

## 폴더 구조

```text
src/
  app/
    api/search/route.ts
    page.tsx
  components/
  lib/
    config/
      provider-mode.ts
    fixtures/
      bunjang/search-results.ts
      fruitsfamily/search-results.ts
      mercari/search-results.ts
      index.ts
      types.ts
    normalizers/
      bunjangNormalizer.ts
      fruitsfamilyNormalizer.ts
      mercariNormalizer.ts
      shared.ts
    providers/
      bunjang/
        collector.ts
        config.ts
        fixtures.ts
        parser.fixture-example.ts
        parser.ts
      fruitsfamily/
        collector.ts
        config.ts
        fixtures.ts
        parser.fixture-example.ts
        parser.ts
      mercari/
        collector.ts
        config.ts
        fixtures.ts
        parser.fixture-example.ts
        parser.ts
      mock/
        fixtureCollector.ts
        scenario.ts
      real/
        notConfiguredCollector.ts
      base.ts
      bunjangProvider.ts
      fruitsfamilyProvider.ts
      mercariProvider.ts
      index.ts
    services/
      search-service.ts
    types/
      market.ts
    utils/
      calculations.ts
      format.ts
      normalize.ts
```

## Mercari 실제 수집기

관련 파일:

- `src/lib/providers/mercari/collector.ts`
- `src/lib/providers/mercari/parser.ts`
- `src/lib/providers/mercari/fixtures.ts`
- `src/lib/providers/mercari/parser.fixture-example.ts`
- `src/lib/normalizers/mercariNormalizer.ts`

동작 방식:

1. 검색 URL 생성
2. headless Chrome/Edge 렌더 DOM 우선 수집
3. item grid 파싱
4. 필요 시 HTTP HTML fallback
5. `on_sale` / `sold_out` 결과 병합 후 normalizer 전달

주의:

- Mercari real collector는 로컬 Chrome 또는 Edge 실행 파일이 필요함
- 필요하면 `MERCARI_CHROME_PATH` 또는 `CHROME_PATH` 환경변수로 경로 지정 가능
- Mercari Shops 항목은 제외

## Bunjang 실제 수집기

관련 파일:

- `src/lib/providers/bunjang/collector.ts`
- `src/lib/providers/bunjang/parser.ts`
- `src/lib/providers/bunjang/fixtures.ts`
- `src/lib/providers/bunjang/parser.fixture-example.ts`
- `src/lib/normalizers/bunjangNormalizer.ts`

동작 방식:

1. 번개장터 검색 API `find_v2.json` 호출
2. parser에서 광고 / 비상품 항목 제거
3. product entry를 `BunjangRawListing`으로 변환
4. normalizer에서 브랜드/모델/카테고리/사이즈를 보강
5. 공통 `MarketListing`으로 정규화

메모:

- 현재는 검색 API 기준으로 active 상품 중심 수집
- 응답에 판매 상태 값이 내려오면 `saleStatus`에 반영
- `listedAt`은 검색 응답의 `update_time` 기준으로 최대한 채움
- 상품 이미지 URL 템플릿의 `{res}`는 실제 썸네일 해상도로 치환

## FruitsFamily 실제 수집기

관련 파일:

- `src/lib/providers/fruitsfamily/collector.ts`
- `src/lib/providers/fruitsfamily/parser.ts`
- `src/lib/providers/fruitsfamily/fixtures.ts`
- `src/lib/providers/fruitsfamily/parser.fixture-example.ts`
- `src/lib/normalizers/fruitsfamilyNormalizer.ts`

동작 방식:

1. FruitsFamily 검색 페이지 HTML 요청
2. SSR HTML 안의 `__APOLLO_STATE__` JSON 추출
3. `ROOT_QUERY.searchProducts(...)` 참조 목록을 따라 검색 결과 제품만 파싱
4. HTML 안의 실제 상품 링크를 함께 읽어 item URL 복원
5. normalizer에서 패션형 title normalization, 브랜드/모델/카테고리 추론 보강

메모:

- 현재 검색 페이지 기준으로 active 상품이 주력이지만, Apollo state의 `status`가 판매완료 상태를 포함하면 `listingType`에 반영
- `itemUrl`은 실제 검색 결과 HTML의 상품 경로를 우선 사용하고, 필요 시 id 기반으로 fallback 생성
- `listedAt`, `price`, `imageUrl`, `brand`, `size`, `category`를 최대한 채우도록 구성

## 에러 처리 정책

마켓별 상태를 독립적으로 관리합니다.

- `success`
- `empty`
- `partial`
- `timeout`
- `parsing_failure`
- `error`

한 마켓이 실패해도 다른 마켓 결과는 계속 반환되며, UI는 `marketResults`를 통해 상태를 표시합니다.

## Mock 시나리오

mock provider에서 아래 토큰을 검색어에 붙이면 예외 상황을 테스트할 수 있습니다.

- `[timeout:mercari]`
- `[error:bunjang]`
- `[partial:fruitsfamily]`
- `[parsefail:all]`

예시:

```text
Supreme Box Logo Hoodie [partial:mercari]
```

실제 검색에는 토큰이 제거된 검색어가 사용됩니다.
