export const MERCARI_ON_SALE_FIXTURE_HTML = `
<div id="item-grid" data-testid="search-item-grid">
  <ul>
    <li data-testid="item-cell">
      <div>
        <a href="/item/m12345678901" data-testid="thumbnail-link">
          <div
            class="merItemThumbnail fluid__fixture"
            role="img"
            aria-label="Supreme Box Logo Hoodie 28700円"
            id="m12345678901"
            itemtype="ITEM_TYPE_MERCARI"
          >
            <figure>
              <div class="imageContainer__fixture" role="img" aria-label="Supreme Box Logo Hoodieのサムネイル">
                <picture>
                  <img
                    alt="Supreme Box Logo Hoodieのサムネイル"
                    src="https://static.mercdn.net/thumb/item/webp/m12345678901_1.jpg?fixture"
                  />
                </picture>
              </div>
              <div class="overlayContent__fixture">
                <div class="priceContainer__fixture">
                  <span class="merPrice">
                    <span class="currency__fixture">¥</span>
                    <span class="number__fixture">28,700</span>
                  </span>
                </div>
              </div>
            </figure>
          </div>
        </a>
      </div>
    </li>
  </ul>
</div>
`;

export const MERCARI_SOLD_FIXTURE_HTML = `
<div id="item-grid" data-testid="search-item-grid">
  <ul>
    <li data-testid="item-cell">
      <div>
        <a href="/item/m10987654321" data-testid="thumbnail-link">
          <div
            class="merItemThumbnail fluid__fixture"
            role="img"
            aria-label="Supreme Box Logo Hoodie 売り切れ 22000円"
            id="m10987654321"
            itemtype="ITEM_TYPE_MERCARI"
          >
            <figure>
              <div class="imageContainer__fixture" role="img" aria-label="Supreme Box Logo Hoodieのサムネイル">
                <picture>
                  <img
                    alt="Supreme Box Logo Hoodieのサムネイル"
                    src="https://static.mercdn.net/thumb/item/webp/m10987654321_1.jpg?fixture"
                  />
                </picture>
              </div>
              <div class="overlayContent__fixture">
                <div role="img" data-testid="thumbnail-sticker" class="sticker__fixture" aria-label="売り切れ"></div>
                <div class="priceContainer__fixture">
                  <span class="merPrice">
                    <span class="currency__fixture">¥</span>
                    <span class="number__fixture">22,000</span>
                  </span>
                </div>
              </div>
            </figure>
          </div>
        </a>
      </div>
    </li>
    <li data-testid="item-cell">
      <div>
        <a href="/shops/product/not-included" data-testid="thumbnail-link">
          <div
            class="merItemThumbnail fluid__fixture"
            role="img"
            aria-label="Shop item 売り切れ 19000円"
            id="not-included"
            itemtype="ITEM_TYPE_BEYOND"
          >
            <figure>
              <div class="imageContainer__fixture" role="img" aria-label="Shop itemのサムネイル">
                <picture>
                  <img
                    alt="Shop itemのサムネイル"
                    src="https://assets.mercari-shops-static.com/-/small/plain/example.jpg@webp"
                  />
                </picture>
              </div>
              <div class="overlayContent__fixture">
                <div role="img" data-testid="thumbnail-sticker" class="sticker__fixture" aria-label="売り切れ"></div>
                <div class="priceContainer__fixture">
                  <span class="merPrice">
                    <span class="currency__fixture">¥</span>
                    <span class="number__fixture">19,000</span>
                  </span>
                </div>
              </div>
            </figure>
          </div>
        </a>
      </div>
    </li>
  </ul>
</div>
`;

export const MERCARI_EMPTY_FIXTURE_HTML = `
<main>
  <section>
    <p>検索結果はありません</p>
  </section>
</main>
`;
