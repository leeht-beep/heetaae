import { BunjangSearchResponse } from "@/lib/providers/bunjang/parser";

export const BUNJANG_SEARCH_FIXTURE_RESPONSE: BunjangSearchResponse = {
  result: "success",
  no_result: false,
  num_found: 3,
  associate_keywords: [{ name: "슈프림" }, { name: "박스로고" }, { name: "후드티" }],
  categories: [
    {
      id: "320",
      title: "남성의류",
      categories: [
        {
          id: "320210",
          title: "상의",
          categories: [
            {
              id: "320210600",
              title: "후드티/후드집업",
            },
          ],
        },
      ],
    },
    {
      id: "400",
      title: "패션 액세서리",
      categories: [
        {
          id: "400070100",
          title: "볼캡",
        },
      ],
    },
  ],
  list: [
    {
      pid: "401268867",
      name: "슈프림 사틴 후드 트랙자켓 브라운",
      price: "320000",
      product_image: "https://media.bunjang.co.kr/product/401268867_1_1776044285_w{res}.jpg",
      status: "0",
      ad: false,
      type: "PRODUCT",
      update_time: 1776150425,
      category_id: "320210600",
      location: "경기도 안산시 단원구 초지동",
    },
    {
      pid: "390000001",
      name: "슈프림 박스로고 볼캡 블랙",
      price: "110000",
      product_image: "https://media.bunjang.co.kr/product/390000001_1_1770000000_w{res}.jpg",
      status: "1",
      ad: false,
      type: "PRODUCT",
      update_time: 1775150425,
      category_id: "400070100",
      location: "서울특별시 마포구 합정동",
    },
    {
      appUrl: "bunjang://new_window",
      name: "슈프림 광고 상품",
      imageUrl: "https://shopping-phinf.pstatic.net/sample.jpg",
      webUrl: "https://example.com/ad",
      type: "EXT_AD",
    },
    {
      pid: "malformed-product",
      type: "PRODUCT",
    },
  ],
};

export const BUNJANG_EMPTY_FIXTURE_RESPONSE: BunjangSearchResponse = {
  result: "success",
  no_result: true,
  no_result_message: "검색 결과가 없습니다.",
  num_found: 0,
  list: [],
  categories: [],
  associate_keywords: [],
};
