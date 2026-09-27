// 画像ファイルの読み込みを担当するファイル。
// ・JPEG/PNG以外は受け付けない
// ・EXIFの回転情報を反映してから読み込む(縦向き写真が横倒しにならないようにする)
// ・画面表示用に縮小した「プレビュー画像」もあわせて作る
//
// このファイルは<script type="module">を使わず、普通の<script>として読み込む。
// (type="module"は、サーバーを介さずindex.htmlを直接ダブルクリックで開いた場合、
//  ブラウザのセキュリティ制限でスクリプトの読み込みがブロックされてしまうため)
// 代わりに、window.App というオブジェクトに関数をぶら下げて、
// 他のファイル(main.jsなど)から使えるようにしている。
window.App = window.App || {};

(function () {
  'use strict';

  // プレビュー画像の最大辺の長さ(px)。
  // これより大きい画像は、この値に収まるように縮小してからプレビュー表示する。
  const MAX_PREVIEW_SIZE = 1400;

  // 「大きな画像です」という警告を出す目安のピクセル数(概算で約4000万画素)。
  // 一部のブラウザ(特にモバイル)ではcanvasのサイズに上限があり、
  // これを超えると保存時に失敗する可能性があるため、あらかじめ注意を促す。
  const LARGE_IMAGE_WARNING_PIXELS = 40_000_000;

  /**
   * 画像ファイルを読み込み、フル解像度とプレビュー用のImageBitmapを作る。
   * @param {File} file 入力ファイル
   * @returns {Promise<{file: File, fullBitmap: ImageBitmap, previewBitmap: ImageBitmap, previewScale: number, warning: string|null}>}
   */
  async function loadImageFile(file) {
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      throw new Error('JPEGまたはPNGの画像を選んでください。');
    }

    // imageOrientation: 'from-image' を指定すると、
    // JPEGのEXIFに記録された回転情報(スマホ・一眼で縦横が入れ替わって記録されている場合など)を
    // ブラウザが自動で反映した状態でデコードしてくれる。
    // これにより、以後の処理はすべて「見た目どおりの向き」の画像として扱える。
    const fullBitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    const previewBitmap = await createPreviewBitmap(fullBitmap);

    // プレビュー座標→元解像度座標に変換するときに掛ける倍率
    const previewScale = fullBitmap.width / previewBitmap.width;

    const warning = checkLargeImageWarning(fullBitmap);

    return { file, fullBitmap, previewBitmap, previewScale, warning };
  }

  /** フル解像度のImageBitmapから、表示用に縮小したImageBitmapを作る */
  function createPreviewBitmap(fullBitmap) {
    const longSide = Math.max(fullBitmap.width, fullBitmap.height);
    const scale = Math.min(1, MAX_PREVIEW_SIZE / longSide);
    const width = Math.max(1, Math.round(fullBitmap.width * scale));
    const height = Math.max(1, Math.round(fullBitmap.height * scale));

    // 第一引数にImageBitmapを渡すことで、元ファイルを読み直さずに縮小できる
    return createImageBitmap(fullBitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' });
  }

  /** 巨大画像の場合、注意メッセージを返す(問題なければnull) */
  function checkLargeImageWarning(fullBitmap) {
    const pixelCount = fullBitmap.width * fullBitmap.height;
    if (pixelCount > LARGE_IMAGE_WARNING_PIXELS) {
      return 'とても大きな画像です。ブラウザによっては保存時にうまく処理できない場合があります。';
    }
    return null;
  }

  window.App.loadImageFile = loadImageFile;
})();
