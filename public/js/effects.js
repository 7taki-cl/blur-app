// 範囲1つぶんの加工(ぼかし/モザイク/塗りつぶし)を実際にピクセルへ適用するファイル。
// ここでの処理は「表示用の画像(previewBitmapなど)」に対して行う。
// 保存時は、同じ考え方を元の解像度の画像に対して行う(次の機能で実装予定)。
window.App = window.App || {};

(function () {
  'use strict';

  /**
   * 1つの範囲の加工を、destCtx(描画先)に重ねて描画する。
   * @param {CanvasRenderingContext2D} destCtx 描画先(プレビューcanvasなど)
   * @param {CanvasImageSource} sourceImage 加工前の、劣化のない元画像
   * @param {{x:number,y:number,width:number,height:number}} box
   *   範囲の位置・サイズ。sourceImageと同じピクセル座標系で指定する
   * @param {{shape:string, effect:string, strength:number, feather:number, color:string}} region
   *   strength・featherは、boxと同じ座標系のpx単位で指定する(呼び出し側でスケール変換しておく)
   */
  function applyRegionEffect(destCtx, sourceImage, box, region) {
    // 範囲の位置を整数ピクセルに丸めておく。
    // (小数位置のままだと、最後にwork canvasを重ねて描画するときにブラウザが自動で
    //  縁をなめらかにしようとして、塗りつぶしの境界がわずかに半透明になってしまうため。
    //  「完全に置き換える」という条件を満たすには、すべての合成を整数ピクセル上で行う必要がある)
    const boxX = Math.round(box.x);
    const boxY = Math.round(box.y);
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));

    // ぼかしは範囲の外側の色も巻き込んで計算されるため、範囲より少し広めに切り出しておく。
    // (そうしないと、範囲の縁でぼかしが不自然に途切れてしまう)
    const padding = region.effect === 'blur' ? Math.ceil(Math.max(0, region.strength)) : 0;
    const srcX = boxX - padding;
    const srcY = boxY - padding;
    const srcW = width + padding * 2;
    const srcH = height + padding * 2;

    // 加工結果を描くための、作業用の一時canvas
    const work = document.createElement('canvas');
    work.width = srcW;
    work.height = srcH;
    const workCtx = work.getContext('2d');

    if (region.effect === 'fill') {
      workCtx.fillStyle = region.color;
      workCtx.fillRect(0, 0, srcW, srcH);
    } else if (region.effect === 'mosaic') {
      drawMosaic(workCtx, sourceImage, srcX, srcY, srcW, srcH, Math.max(2, Math.round(region.strength)));
    } else {
      // 既定はぼかし
      workCtx.filter = `blur(${Math.max(0, region.strength)}px)`;
      workCtx.drawImage(sourceImage, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      workCtx.filter = 'none';
    }

    // マスク(型紙)を作る: 範囲の形(楕円/矩形)の部分だけを白で描く
    const mask = document.createElement('canvas');
    mask.width = srcW;
    mask.height = srcH;
    // 塗りつぶしのときはgetImageData/putImageDataを毎回使うので、willReadFrequentlyで高速化しておく
    const maskCtx = mask.getContext('2d', { willReadFrequently: region.effect === 'fill' });
    maskCtx.fillStyle = '#fff';
    if (region.shape === 'ellipse') {
      maskCtx.beginPath();
      maskCtx.ellipse(padding + width / 2, padding + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      maskCtx.fill();
    } else {
      maskCtx.fillRect(padding, padding, width, height);
    }

    if (region.effect === 'fill') {
      // 塗りつぶしは「元のピクセル値を完全に置き換える(半透明にしない)」という条件があるため、
      // 図形の縁がなめらかになる(半透明になる)アンチエイリアスの影響を取り除き、
      // マスクを「完全に塗る/完全に塗らない」の2値だけにする。
      binarizeMaskAlpha(maskCtx, srcW, srcH);
    } else if (region.feather > 0) {
      // フェザー(縁のなじませ): マスクの縁をぼかして、型紙の境界を滑らかにする
      maskCtx.filter = `blur(${region.feather}px)`;
      maskCtx.drawImage(mask, 0, 0);
      maskCtx.filter = 'none';
    }

    // マスクを型紙として使い、加工結果画像から「形の内側だけ」を残す
    workCtx.globalCompositeOperation = 'destination-in';
    workCtx.drawImage(mask, 0, 0);
    workCtx.globalCompositeOperation = 'source-over';

    // 完成した加工結果を、本来の位置に重ねて描画する
    destCtx.drawImage(work, srcX, srcY);
  }

  /** モザイク: 一度うんと小さく縮小してから、なめらかにせずに拡大し直すことで粒状にする */
  function drawMosaic(destCtx, sourceImage, srcX, srcY, srcW, srcH, blockSize) {
    const smallW = Math.max(1, Math.round(srcW / blockSize));
    const smallH = Math.max(1, Math.round(srcH / blockSize));

    const small = document.createElement('canvas');
    small.width = smallW;
    small.height = smallH;
    small.getContext('2d').drawImage(sourceImage, srcX, srcY, srcW, srcH, 0, 0, smallW, smallH);

    destCtx.imageSmoothingEnabled = false;
    destCtx.drawImage(small, 0, 0, smallW, smallH, 0, 0, srcW, srcH);
    destCtx.imageSmoothingEnabled = true;
  }

  /** マスクの透明度を0か255だけにする(アンチエイリアスによる半透明ピクセルをなくす) */
  function binarizeMaskAlpha(maskCtx, width, height) {
    const imageData = maskCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = data[i] >= 128 ? 255 : 0;
    }
    maskCtx.putImageData(imageData, 0, 0);
  }

  window.App.effects = { applyRegionEffect };
})();
