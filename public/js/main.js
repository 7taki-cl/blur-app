// アプリの起動処理。
// 「画像を選ぶ→プレビュー表示」「ドラッグで範囲を作成」「選択・移動・リサイズ・削除」に加えて、
// 選択中の範囲の加工(ぼかし/モザイク/塗りつぶし)を設定パネルから編集できるようにする。
// image-loader.js / region-store.js / effects.js / canvas-view.js が先に読み込まれている前提。

(function () {
  'use strict';

  const fileInput = document.getElementById('file-input');
  const canvas = document.getElementById('preview-canvas');
  const canvasWrap = document.getElementById('canvas-wrap');
  const messageEl = document.getElementById('message');

  const zoomOutButton = document.getElementById('zoom-out-button');
  const zoomInButton = document.getElementById('zoom-in-button');
  const zoomResetButton = document.getElementById('zoom-reset-button');
  const zoomLevelText = document.getElementById('zoom-level-text');
  const panToggleButton = document.getElementById('pan-toggle-button');

  const regionPanel = document.getElementById('region-panel');
  const effectSelect = document.getElementById('effect-select');
  const strengthRange = document.getElementById('strength-range');
  const strengthValueEl = document.getElementById('strength-value');
  const featherRow = document.getElementById('feather-row');
  const featherRange = document.getElementById('feather-range');
  const featherValueEl = document.getElementById('feather-value');
  const colorRow = document.getElementById('color-row');
  const colorInput = document.getElementById('color-input');
  const deleteRegionButton = document.getElementById('delete-region-button');

  const saveButton = document.getElementById('save-button');
  const qualityRow = document.getElementById('quality-row');
  const qualityRange = document.getElementById('quality-range');
  const qualityValueEl = document.getElementById('quality-value');
  const saveStatusEl = document.getElementById('save-status');

  // 読み込んだ画像の情報をここに保持する(画像を選び直すたびに入れ替わる)
  let currentImage = null;

  // 拡大表示(ズーム)まわりの状態
  const ZOOM_MIN = 1; // 1 = 画面に収まる大きさ(拡大なし)
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.5;
  let zoomLevel = ZOOM_MIN;
  // 「画像を動かす」モード中かどうか。trueの間は、ドラッグが範囲の操作ではなく画像を動かす操作になる
  let panMode = false;

  /**
   * ズームの倍率にあわせて、canvasのCSS上の表示サイズを設定する。
   * 等倍(1)のときは、いつもどおりCSSの max-width/max-height にまかせて「画面に収まる」大きさにする。
   * それより拡大するときは、その「画面に収まる」幅を基準にして、倍率ぶん大きい幅を直接指定する。
   * (canvas自体が持っているピクセル数=画質はプレビュー解像度のままなので、拡大しすぎると少し粗く見える)
   */
  function applyZoom() {
    if (!currentImage) return;

    if (zoomLevel <= ZOOM_MIN) {
      canvas.style.maxWidth = '';
      canvas.style.maxHeight = '';
      canvas.style.width = '';
      canvas.style.height = '';
      return;
    }

    const bitmap = currentImage.previewBitmap;
    const containerWidth = canvasWrap.clientWidth || bitmap.width;
    const baseWidth = Math.min(containerWidth, bitmap.width);
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.width = `${Math.round(baseWidth * zoomLevel)}px`;
    canvas.style.height = 'auto';
  }

  /** ズーム関連のボタンの有効/無効・表示を、今の状態にあわせて更新する */
  function updateZoomControls() {
    const hasImage = !!currentImage;
    zoomOutButton.disabled = !hasImage || zoomLevel <= ZOOM_MIN;
    zoomInButton.disabled = !hasImage || zoomLevel >= ZOOM_MAX;
    zoomResetButton.disabled = !hasImage;
    panToggleButton.disabled = !hasImage;
    zoomLevelText.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  /** 「画像を動かす」モードのオン/オフを切り替える */
  function setPanMode(next) {
    panMode = next;
    canvas.classList.toggle('pan-mode', panMode);
    panToggleButton.classList.toggle('is-active', panMode);
    panToggleButton.textContent = panMode ? '編集する' : '画像を動かす';
  }

  zoomInButton.addEventListener('click', () => {
    zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP);
    applyZoom();
    updateZoomControls();
  });

  zoomOutButton.addEventListener('click', () => {
    zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP);
    applyZoom();
    updateZoomControls();
  });

  zoomResetButton.addEventListener('click', () => {
    zoomLevel = ZOOM_MIN;
    applyZoom();
    canvasWrap.scrollLeft = 0;
    canvasWrap.scrollTop = 0;
    updateZoomControls();
  });

  panToggleButton.addEventListener('click', () => {
    setPanMode(!panMode);
  });

  /** ツールバーで選ばれている形(楕円/矩形)を取得する */
  function getSelectedShape() {
    const checked = document.querySelector('input[name="shape"]:checked');
    return checked ? checked.value : 'ellipse';
  }

  /** canvasに現在の画像と範囲を描き直す */
  function redraw() {
    if (!currentImage) return;
    window.App.canvasView.render(
      canvas,
      currentImage.previewBitmap,
      currentImage.previewScale,
      window.App.regionStore.getRegions(),
      window.App.regionStore.getSelectedId(),
      null
    );
  }

  /** 画面下のメッセージ欄を、現在の画像・範囲の数にあわせて更新する */
  function updateMessage() {
    if (!currentImage) return;
    const { file, fullBitmap, previewBitmap, warning } = currentImage;
    const regionCount = window.App.regionStore.getRegions().length;

    let text = `${file.name}(元の解像度: ${fullBitmap.width}×${fullBitmap.height}px / `
      + `プレビュー表示: ${previewBitmap.width}×${previewBitmap.height}px) / 範囲: ${regionCount}個`;
    if (warning) {
      text += ` ※${warning}`;
    }
    messageEl.textContent = text;
  }

  /** 選択中の範囲の内容にあわせて、右側の設定パネルを表示・更新する(選択がなければ中身を隠す) */
  function updatePanel() {
    const selectedId = window.App.regionStore.getSelectedId();
    const region = window.App.regionStore.getRegions().find((r) => r.id === selectedId);

    if (!region) {
      // 表示/非表示ではなく見た目だけ隠す(パネルの場所自体はプレビュー画像のガタつき防止のため常に確保する)
      regionPanel.classList.add('is-empty');
      return;
    }

    regionPanel.classList.remove('is-empty');
    effectSelect.value = region.effect;

    // スライダーの上限は、今の強さの値が収まるように余裕を持たせる
    strengthRange.max = String(Math.max(200, Math.ceil(region.strength * 1.5)));
    strengthRange.value = String(region.strength);
    strengthValueEl.textContent = `${region.strength}px`;

    featherRange.max = String(Math.max(150, Math.ceil(region.feather * 1.5)));
    featherRange.value = String(region.feather);
    featherValueEl.textContent = `${region.feather}px`;

    colorInput.value = region.color;

    // 塗りつぶしにはフェザーを適用しない条件のため、フェザーの行は隠す。色の行は塗りつぶしのときだけ表示
    featherRow.style.display = region.effect === 'fill' ? 'none' : '';
    colorRow.style.display = region.effect === 'fill' ? '' : 'none';
  }

  /** 範囲の作成・削除・選択などで、画面表示をまとめて更新する */
  function refreshUI() {
    updateMessage();
    updatePanel();
  }

  /** ファイルを読み込む処理(ファイル選択・ドラッグ&ドロップの両方から使う) */
  async function handleFileSelected(file) {
    if (!file) return;

    messageEl.textContent = '読み込み中...';

    try {
      currentImage = await window.App.loadImageFile(file);
      // 新しい画像を開いたら、前の画像の範囲は引き継がない
      window.App.regionStore.clear();
      redraw();
      refreshUI();

      saveButton.disabled = false;
      saveStatusEl.textContent = '';
      // JPEGを開いているときだけ、画質スライダーを表示する(PNGは常に無劣化なので不要)
      qualityRow.hidden = currentImage.file.type !== 'image/jpeg';

      // 新しい画像を開いたら、ズーム・パンの状態もリセットする
      zoomLevel = ZOOM_MIN;
      setPanMode(false);
      applyZoom();
      canvasWrap.scrollLeft = 0;
      canvasWrap.scrollTop = 0;
      updateZoomControls();
    } catch (err) {
      currentImage = null;
      saveButton.disabled = true;
      qualityRow.hidden = true;
      messageEl.textContent = `読み込みに失敗しました: ${err.message}`;
      console.error(err);
      updateZoomControls();
    }
  }

  fileInput.addEventListener('change', (event) => {
    handleFileSelected(event.target.files[0]);
  });

  // 画面のどこにでも画像ファイルをドラッグ&ドロップして読み込めるようにする
  let dragCounter = 0; // 子要素へのdragenter/dragleaveが重なっても正しく判定するためのカウンター

  document.body.addEventListener('dragover', (event) => {
    // これを呼ばないと、ブラウザが「ファイルを開く」動作をしてドロップを受け付けてくれない
    event.preventDefault();
  });

  document.body.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragCounter++;
    document.body.classList.add('drag-over');
  });

  document.body.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) {
      document.body.classList.remove('drag-over');
    }
  });

  document.body.addEventListener('drop', (event) => {
    event.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('drag-over');

    const file = event.dataTransfer.files[0];
    if (file) {
      // 「ファイルを選択」欄の表示(ファイル名)も、ドロップしたファイルにあわせておく
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
    }
    handleFileSelected(file);
  });

  qualityRange.addEventListener('input', () => {
    qualityValueEl.textContent = qualityRange.value;
  });

  saveButton.addEventListener('click', async () => {
    if (!currentImage) return;

    saveButton.disabled = true;
    saveStatusEl.textContent = '保存中…(画像が大きいと少し時間がかかることがあります)';

    // メッセージが画面に表示されてから重い処理を始めるため、一呼吸だけ待つ
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const quality = Number(qualityRange.value);
      const result = await window.App.exporter.exportAndDownload(
        currentImage,
        window.App.regionStore.getRegions(),
        quality
      );
      saveStatusEl.textContent = `保存しました(${result.width}×${result.height}px)`;
    } catch (err) {
      saveStatusEl.textContent = `保存に失敗しました: ${err.message}`;
      console.error(err);
    } finally {
      saveButton.disabled = false;
    }
  });

  // プレビュー上でのドラッグ操作で、範囲の作成・選択・移動・リサイズができるようにする
  window.App.canvasView.attachInteractions(
    canvas,
    canvasWrap,
    () => {
      if (!currentImage) return null;
      return {
        previewBitmap: currentImage.previewBitmap,
        previewScale: currentImage.previewScale,
        shape: getSelectedShape(),
        fullWidth: currentImage.fullBitmap.width,
        fullHeight: currentImage.fullBitmap.height,
      };
    },
    () => panMode,
    refreshUI
  );

  /** 選択中の範囲を削除する(Deleteキー・削除ボタンの両方から使う) */
  function deleteSelectedRegion() {
    const selectedId = window.App.regionStore.getSelectedId();
    if (!selectedId) return;

    window.App.regionStore.removeRegion(selectedId);
    redraw();
    refreshUI();
  }

  // Deleteキーで、選択中の範囲を削除する
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete') return;
    deleteSelectedRegion();
  });

  // スマホ・タブレットには物理的なDeleteキーがないため、ボタンからも削除できるようにする
  deleteRegionButton.addEventListener('click', deleteSelectedRegion);

  // 設定パネルの操作で、選択中の範囲の加工内容を書き換える
  function withSelectedRegion(callback) {
    const selectedId = window.App.regionStore.getSelectedId();
    if (!selectedId) return;
    callback(selectedId);
    redraw();
  }

  effectSelect.addEventListener('change', () => {
    withSelectedRegion((id) => {
      window.App.regionStore.updateRegion(id, { effect: effectSelect.value });
      updatePanel();
    });
  });

  strengthRange.addEventListener('input', () => {
    withSelectedRegion((id) => {
      const value = Number(strengthRange.value);
      window.App.regionStore.updateRegion(id, { strength: value });
      strengthValueEl.textContent = `${value}px`;
    });
  });

  featherRange.addEventListener('input', () => {
    withSelectedRegion((id) => {
      const value = Number(featherRange.value);
      window.App.regionStore.updateRegion(id, { feather: value });
      featherValueEl.textContent = `${value}px`;
    });
  });

  colorInput.addEventListener('input', () => {
    withSelectedRegion((id) => {
      window.App.regionStore.updateRegion(id, { color: colorInput.value });
    });
  });
})();
