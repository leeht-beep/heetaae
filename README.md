# Market Resell Web MVP

Mercari Japan, 번개장터, FruitsFamily를 동시에 검색해서 일본 매입가 대비 한국 재판매 가능성을 빠르게 판단하는 Next.js 기반 반응형 웹 MVP입니다.

현재 프로젝트는 UI 자체보다 검색 파이프라인 품질에 초점을 맞추고 있습니다. 각 마켓은 `collector -> parser -> normalizer -> ranking -> aggregation` 흐름으로 분리되어 있고, `mock` / `real` 모드를 동일한 contract 위에서 교체할 수 있습니다.

## Run

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 으로 접속합니다.

## Verify

```bash
npm run typecheck
npm run build
```

## Current Scope

- 3개 마켓 통합 검색 UI
- 추천 / 전체 / 판매중 / 판매완료 / 마켓별 탭
- 요약 카드, 평균가 비교, 거래량 추정, 추천 매입가 계산
- 추천 점수, 상세 모달, 유사 상품 그룹 비교
- provider별 상태 / confidence / debug 정보
- Mercari / 번개장터 / FruitsFamily 실제 수집 provider 연결
- 개발 모드용 Search Debug 패널
- benchmark runner / alias dictionary / regression guard
- category preset 기반 검색 튜닝

## Search Pipeline

검색 파이프라인은 아래 단계로 분리되어 있습니다.

1. query preprocessing
2. provider fetch
3. parser
4. normalization
5. ranking / filtering
6. aggregation / recommendation

핵심 파일:

- `src/lib/utils/query.ts`
- `src/lib/utils/normalize.ts`
- `src/lib/normalizers/shared.ts`
- `src/lib/services/search-service.ts`
- `src/lib/utils/calculations.ts`

## Category Presets

검색 품질을 상품군별로 튜닝하기 위해 preset 구조를 지원합니다.

- `fashion`
- `camera`
- `vintage_furniture`

Preset 정의 파일:

- `src/lib/search/presets.ts`

Preset이 제어하는 항목:

- noise keywords
- preferred aliases
- relevance weights
- similarity thresholds
- preferred query variant strategies
- category-specific normalization rules
- recommendation score thresholds

기본값은 `auto` 감지이며, 검색어/alias를 바탕으로 자동 선택됩니다. 필요하면 UI에서 수동으로 선택하거나 API에서 직접 지정할 수 있습니다.

예시:

```bash
GET /api/search?q=Leica%20M6&preset=camera
GET /api/search?q=Herman%20Miller%20Aeron&preset=vintage_furniture
GET /api/search?q=Supreme%20Box%20Logo%20Hoodie&preset=fashion
```

## Alias Dictionary

한글 / 영문 / 일문 혼합 검색을 위해 alias 사전을 별도로 관리합니다.

사전 파일:

- `src/lib/search/alias-dictionary.ts`

이 사전은 query preprocessing, localized query variants, preset detection, benchmark 튜닝에 함께 사용됩니다.

## Provider Architecture

공통 계약:

- `RawMarketCollector`: 마켓 원본 응답 수집
- `MarketNormalizer`: 원본 응답을 공통 listing 구조로 변환
- `MarketDataSource`: collector + normalizer 조합
- `runMarketDataSource`: timeout, error, normalization, summary 공통 처리

핵심 파일:

- `src/lib/providers/base.ts`
- `src/lib/types/market.ts`

실제 provider 구현:

- `src/lib/providers/mercariProvider.ts`
- `src/lib/providers/bunjangProvider.ts`
- `src/lib/providers/fruitsfamilyProvider.ts`

세부 collector / parser:

- `src/lib/providers/mercari/collector.ts`
- `src/lib/providers/mercari/parser.ts`
- `src/lib/providers/bunjang/collector.ts`
- `src/lib/providers/bunjang/parser.ts`
- `src/lib/providers/fruitsfamily/collector.ts`
- `src/lib/providers/fruitsfamily/parser.ts`

## Search Debug

개발 모드에서는 Search Debug 패널이 열립니다.

표시 정보:

- normalized query
- applied preset / preset source
- cache hit / miss
- 전체 소요 시간
- alias matches
- planned query variants
- provider별 attempted queries
- raw / normalized / filtered count
- fallback 사용 여부

## Benchmark Runner

실전 검색어 세트로 provider별 품질을 비교하려면 benchmark runner를 사용합니다.

```bash
npm run dev
```

다른 터미널에서:

```bash
npm run benchmark
```

자주 쓰는 예시:

```bash
npm run benchmark -- --tags=core
npm run benchmark -- --tags=core,fashion --maxQueries=8
npm run benchmark -- --ids=supreme-box-logo-ko,auralee-super-light-ja
npm run benchmark -- --preset=camera --ids=leica-m6-en
npm run benchmark -- --comparePresets=true --tags=core
npm run benchmark:assert -- --tags=core
```

benchmark route:

- `GET /api/benchmark`
- 주요 파라미터: `mode`, `tags`, `ids`, `maxQueries`, `delayMs`, `limit`, `preset`, `comparePresets`

## Preset Benchmarking

benchmark runner는 같은 검색어를 `auto`, `fashion`, `camera`, `vintage_furniture`로 각각 실행해서 비교할 수 있습니다.

예시:

```bash
npm run benchmark -- --tags=core --comparePresets=true
npm run benchmark -- --preset=camera --ids=leica-m6-en --comparePresets=true
npm run benchmark -- --preset=vintage_furniture --ids=herman-miller-aeron-ko --comparePresets=true
```

API 예시:

```bash
GET /api/benchmark?tags=core&comparePresets=1
GET /api/benchmark?ids=leica-m6-en&preset=camera&comparePresets=1
```

benchmark report에는 아래 정보가 포함됩니다.

- provider별 status / raw / normalized / filtered count
- top relevance / top confidence
- fallback 사용 여부
- best variant / variant leaderboard
- applied preset / preset source
- per-query preset comparison summary
- best preset
- tuning priorities
- regression warnings

## Benchmark Dataset

대표 검색어 세트는 아래 파일에서 관리합니다.

- `src/lib/benchmarks/dataset.ts`

일부 쿼리는 `recommendedPreset` 메타데이터를 가질 수 있습니다. 이 값은 아래 용도로 유용합니다.

- auto preset이 기대한 카테고리를 잘 골랐는지 확인
- 수동 preset이 auto보다 더 나은지 비교
- alias / scoring 수정 후 회귀 감지

## Regression Guard

benchmark runner는 단순 출력만 하는 것이 아니라 baseline과 비교해서 품질 하락을 감지합니다.

baseline 파일:

- `src/lib/benchmarks/baseline.ts`

현재 baseline은 아래 항목을 봅니다.

- provider별 useful rate
- provider별 average top relevance
- provider별 average top confidence
- provider별 blocked rate
- 핵심 검색어에서 최소 몇 개 provider가 결과를 내야 하는지

```bash
npm run benchmark:assert -- --tags=core
```

심한 regression이 감지되면 종료 코드 `1`로 실패합니다.

## Fixtures

collector / parser 개발용 fixture:

- `src/lib/providers/mercari/fixtures.ts`
- `src/lib/providers/mercari/parser.fixture-example.ts`
- `src/lib/providers/bunjang/fixtures.ts`
- `src/lib/providers/bunjang/parser.fixture-example.ts`
- `src/lib/providers/fruitsfamily/fixtures.ts`
- `src/lib/providers/fruitsfamily/parser.fixture-example.ts`

정규화 예시:

- `src/lib/utils/normalize.fixture-example.ts`

## Provider Mode

설정 파일:

- `src/lib/config/provider-mode.ts`

지원 모드:

- `real`
- `mock`

전환 방식:

- 기본값은 `real`
- API에서 `mode=mock` 또는 `mode=real`
- 환경변수 `MARKET_PROVIDER_MODE=mock`

## Notes

- 실제 마켓 구조가 바뀌면 parser / collector 조정이 필요할 수 있습니다.
- 개발 모드의 Search Debug와 benchmark preset comparison을 같이 보면 어느 단계에서 품질이 떨어지는지 빠르게 찾을 수 있습니다.
- 외부 이미지 호스트는 `next.config.ts`에 등록되어 있습니다.
