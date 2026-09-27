// 元の解像度で加工を焼き込み、画像として保存(ダウンロード)する処理をまとめたファイル。
// ・保存形式は入力画像にあわせる(JPEG→JPEG、PNG→PNG)
// ・canvasから書き出すので、EXIFなどのメタデータは含まれない
// ・元のファイルは一切書き換えず、新しいファイルとしてダウンロードする
window.App = window.App || {};

(function () {
  'use strict';

  /**
   * 元の解像度のcanvasに、画像本体とすべての範囲の加工を描画する。
   * @param {{fullBitmap: ImageBitmap}} image
   * @param {object[]} regions 範囲のリスト(座標・強さ・フェザーは元画像の解像度のpx基準)
   * @returns {HTMLCanvasElement}
   */
  function renderFullResolution(image, regions) {
    const canvas = document.createElement('canvas');
    canvas.width = image.fullBitmap.width;
    canvas.height = image.fullBitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image.fullBitmap, 0, 0);

    for (const region of regions) {
      const box = { x: region.x, y: region.y, width: region.width, height: region.height };
      // 範囲の座標・強さ・フェザーは、もともと元画像の解像度のpxで保存されているので、
      // プレビューのときと違って倍率変換は不要
      window.App.effects.applyRegionEffect(ctx, image.fullBitmap, box, region);
    }

    return canvas;
  }

  /** 元のファイル名から、保存用のファイル名(「_blurred」を付けたもの)を作る */
  function buildDownloadFileName(originalName) {
    const dotIndex = originalName.lastIndexOf('.');
    if (dotIndex <= 0) return originalName + '_blurred';
    return originalName.slice(0, dotIndex) + '_blurred' + originalName.slice(dotIndex);
  }

  /**
   * 画像を保存する(ブラウザのダウンロード機能で新しいファイルとして保存する)。
   * @param {{fullBitmap: ImageBitmap, file: File}} image
   * @param {object[]} regions
   * @param {number} jpegQuality JPEG保存時の画質(0〜1)。PNGのときは使われない
   * @returns {Promise<{width:number, height:number, mimeType:string}>}
   */
  async function exportAndDownload(image, regions, jpegQuality) {
    const canvas = renderFullResolution(image, regions);
    const mimeType = image.file.type === 'image/png' ? 'image/png' : 'image/jpeg';

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('画像の書き出しに失敗しました'))),
        mimeType,
        mimeType === 'image/jpeg' ? jpegQuality : undefined
      );
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDownloadFileName(image.file.name);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // ダウンロードが始まった後に解放すれば十分なので、少し待ってから片付ける
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { width: canvas.width, height: canvas.height, mimeType };
  }

  window.App.exporter = { exportAndDownload, buildDownloadFileName };
})();
