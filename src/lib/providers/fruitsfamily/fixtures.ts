export const FRUITSFAMILY_SEARCH_FIXTURE_HTML = `
<!DOCTYPE html>
<html lang="ko">
  <head>
    <title>supreme 검색결과 | 후루츠패밀리</title>
  </head>
  <body>
    <a href="/product/40uzy/%EC%8A%88%ED%94%84%EB%A6%BC-X-%EB%B9%84%EB%B9%84%EC%82%AC%EC%9D%B4%EB%A8%BC-%EB%B0%B1%ED%8C%A9">상품 1</a>
    <a href="/product/3c6i1/%EC%8A%88%ED%94%84%EB%A6%BC-%EC%B2%B4%ED%81%AC-%EC%85%94%EC%B8%A0">상품 2</a>
    <script id="__APOLLO_STATE__" type="application/json">
      {
        "ROOT_QUERY": {
          "__typename": "Query",
          "searchProducts({\\"filter\\":{\\"query\\":\\"supreme\\"},\\"limit\\":40,\\"offset\\":0,\\"sort\\":\\"POPULAR\\"})": [
            { "__ref": "ProductNotMine:6758638" },
            { "__ref": "ProductNotMine:5607145" }
          ]
        },
        "ProductNotMine:6758638": {
          "__typename": "ProductNotMine",
          "id": "6758638",
          "title": "슈프림 X 비비사이먼 카모 데님 백팩",
          "brand": "Supreme",
          "status": "selling",
          "resizedSmallImages": [
            "https://image.production.fruitsfamily.com/public/product/resized%40width620/sample-bag.jpg"
          ],
          "createdAt": "2026-04-10T07:56:54.000Z",
          "category": "가방",
          "description": "협업 백팩 제품입니다. #슈프림 #백팩",
          "price": 330000,
          "is_visible": true,
          "size": "OS",
          "condition": "GOOD_CONDITION"
        },
        "ProductNotMine:5607145": {
          "__typename": "ProductNotMine",
          "id": "5607145",
          "title": "슈프림 메탈릭 체크 셔츠",
          "brand": "Supreme",
          "status": "sold",
          "resizedSmallImages": [
            "https://image.production.fruitsfamily.com/public/product/resized%40width620/sample-shirt.jpg"
          ],
          "createdAt": "2025-08-27T08:48:21.000Z",
          "updatedAt": "2025-09-01T11:20:00.000Z",
          "category": "상의",
          "description": "좋은 컨디션의 체크 셔츠",
          "price": 190000,
          "is_visible": true,
          "size": "S",
          "condition": "LIGHTLY_WORN"
        }
      }
    </script>
  </body>
</html>
`.trim();

export const FRUITSFAMILY_EMPTY_FIXTURE_HTML = `
<!DOCTYPE html>
<html lang="ko">
  <body>
    <script id="__APOLLO_STATE__" type="application/json">
      {
        "ROOT_QUERY": {
          "__typename": "Query",
          "searchProducts({\\"filter\\":{\\"query\\":\\"missing\\"},\\"limit\\":40,\\"offset\\":0,\\"sort\\":\\"POPULAR\\"})": []
        }
      }
    </script>
  </body>
</html>
`.trim();
