const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('http://localhost:5176', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('text=ソーラーシェアリング設計シミュレーター', { timeout: 10000 });
  await page.waitForTimeout(800);

  // 1. 地盤傾斜UIが表示されているか
  const hasSlopeUI = await page.locator('text=地盤傾斜').count();
  console.log('GROUND_SLOPE_UI_VISIBLE:', hasSlopeUI);

  // 2. 3D地形ボタンが表示されているか
  const hasTerrainBtn = await page.locator('button:has-text("3D地形")').count();
  console.log('TERRAIN_3D_BTN_VISIBLE:', hasTerrainBtn);

  // 3. 地盤傾斜に値を入力して影が変わるか確認（スクリーンショット）
  await page.screenshot({ path: '/tmp/t1_initial.png' });

  // 4. 3D地形ボタンをクリック
  await page.click('button:has-text("3D地形")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/t2_terrain3d.png' });
  const terrainBtnActive = await page.locator('button.btn-terrain.active').count();
  console.log('TERRAIN_BTN_ACTIVE:', terrainBtnActive);

  // 5. 法面追加して地盤傾斜をデフォルト値で確認
  await page.click('button:has-text("＋ 法面を追加")');
  await page.waitForTimeout(500);
  const slopeInstAdded = await page.locator('.inst-card:has-text("法面")').count();
  console.log('SLOPE_INST_ADDED:', slopeInstAdded);
  await page.screenshot({ path: '/tmp/t3_slope_added.png' });

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
