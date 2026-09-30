// プレビュー用canvasへの描画と、範囲に対する操作(Pointer Events)をまとめたファイル。
// できる操作:
//  ・何もない場所をドラッグ → 新しい範囲を作成
//  ・範囲の内側をドラッグ → その範囲を選択して移動
//  ・選択中の範囲の四隅・辺のハンドルをドラッグ → リサイズ
window.App = window.App || {};

(function () {
  'use strict';

  // 確定済み(未選択)の範囲の枠線の色
  const REGION_STROKE = '#00c8ff';
  // 選択中の範囲の枠線の色
  const SELECTED_STROKE = '#ffd400';
  // ドラッグ中(まだ確定していない)範囲の枠線の色
  const DRAFT_STROKE = '#ff5050';

  // ドラッグで範囲を作成する最小サイズ(canvasのピクセル基準)。これより小さい操作は誤クリックとみなす。
  const MIN_DRAG_SIZE = 6;
  // リサイズ後に範囲がこれより小さくならないようにする(元画像の解像度基準のpx)
  const MIN_REGION_SIZE = 10;
  // リサイズ用ハンドルの見た目の大きさ(canvasのピクセル基準)
  const HANDLE_SIZE = 12;

  // 指でタップ・ドラッグしても押しやすいように、当たり判定の最小の大きさを
  // 「画面に表示されている見た目のサイズ(CSSピクセル)」基準で決める。
  // プレビューが小さく縮小表示されているほど(=スマホの画面が小さいほど)、
  // canvas内部のピクセル数としては大きめの当たり判定になるよう、表示倍率にあわせて変換する。
  const HANDLE_TOUCH_TARGET_CSS_PX = 32;
  const BODY_HIT_PADDING_CSS_PX = 10; // 範囲の内側をタップするときの、縁での許容誤差

  // ハンドルの当たり判定は、これより小さくはしない(見た目のハンドルより一回り大きい程度)
  const HANDLE_HIT_MIN = HANDLE_SIZE + 6;
  // 範囲自体が小さいとき、当たり判定が範囲全体を覆ってしまい本体(移動用)をつまめなくならないよう、
  // 「範囲の短いほうの辺」に対する割合で上限を決める
  const HANDLE_HIT_MAX_FRACTION_OF_BOX = 0.5;

  /**
   * canvasに「元画像のプレビュー」「確定済みの範囲」「選択中の範囲のハンドル」「ドラッグ中の枠」を描画する。
   * @param {HTMLCanvasElement} canvas
   * @param {ImageBitmap} previewBitmap
   * @param {number} previewScale 元解像度の座標をプレビュー座標に変換するときに割る倍率
   * @param {object[]} regions 範囲のリスト(座標は元画像の解像度基準)
   * @param {string|null} selectedId 選択中の範囲のID
   * @param {{shape:string,x:number,y:number,width:number,height:number}|null} draftRegion
   *   ドラッグ中の範囲。canvasのピクセル座標(変換不要)で渡す
   */
  function render(canvas, previewBitmap, previewScale, regions, selectedId, draftRegion) {
    canvas.width = previewBitmap.width;
    canvas.height = previewBitmap.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(previewBitmap, 0, 0);

    // 先にすべての範囲の加工(ぼかし/モザイク/塗りつぶし)を焼き込み、
    // そのあとで枠線・ハンドルを上から描く(枠線が加工で隠れないようにするため)
    for (const region of regions) {
      const box = originalBoxToCanvasBox(region, previewScale);
      // strength・featherは元解像度基準のpxで保存されているので、プレビューの縮尺にあわせて変換する
      const previewRegion = Object.assign({}, region, {
        strength: region.strength / previewScale,
        feather: region.feather / previewScale,
      });
      window.App.effects.applyRegionEffect(ctx, previewBitmap, box, previewRegion);
    }

    for (const region of regions) {
      const isSelected = region.id === selectedId;
      const box = originalBoxToCanvasBox(region, previewScale);
      drawShapeOutline(ctx, region.shape, box, isSelected ? SELECTED_STROKE : REGION_STROKE, false, isSelected ? 3 : 2);
      if (isSelected) {
        drawHandles(ctx, box);
      }
    }

    if (draftRegion) {
      drawShapeOutline(ctx, draftRegion.shape, draftRegion, DRAFT_STROKE, true, 2);
    }
  }

  /** 元解像度基準の範囲を、canvasのピクセル座標の矩形(バウンディングボックス)に変換する */
  function originalBoxToCanvasBox(region, previewScale) {
    return {
      x: region.x / previewScale,
      y: region.y / previewScale,
      width: region.width / previewScale,
      height: region.height / previewScale,
    };
  }

  /** 矩形または楕円の枠線を1つ描画する(canvasのピクセル座標基準のboxを渡す) */
  function drawShapeOutline(ctx, shape, box, strokeStyle, dashed, lineWidth) {
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed ? [6, 4] : []);

    ctx.beginPath();
    if (shape === 'ellipse') {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      ctx.ellipse(cx, cy, Math.max(0, box.width / 2), Math.max(0, box.height / 2), 0, 0, Math.PI * 2);
    } else {
      ctx.rect(box.x, box.y, box.width, box.height);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** リサイズ用ハンドル8個の位置(canvasのピクセル座標)を返す */
  function handlePositions(box) {
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    return {
      nw: { x: box.x, y: box.y },
      n: { x: midX, y: box.y },
      ne: { x: right, y: box.y },
      e: { x: right, y: midY },
      se: { x: right, y: bottom },
      s: { x: midX, y: bottom },
      sw: { x: box.x, y: bottom },
      w: { x: box.x, y: midY },
    };
  }

  function drawHandles(ctx, box) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    const positions = handlePositions(box);
    for (const key in positions) {
      const p = positions[key];
      ctx.fillRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    }
    ctx.restore();
  }

  /** canvasが今どれくらいの倍率で縮小/拡大表示されているか(表示上の1pxが、canvas内部の何pxにあたるか) */
  function getCanvasCssScale(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 1;
    return Math.max(canvas.width / rect.width, canvas.height / rect.height);
  }

  /** 指定した点がどのハンドルの近くにあるかを調べる(なければnull) */
  function hitTestHandle(point, box, canvas) {
    // 指でも押しやすい大きさを基本にしつつ、範囲自体が小さいときは
    // 当たり判定が範囲全体を覆って本体(移動用)をつまめなくならないよう上限を設ける
    const touchTarget = HANDLE_TOUCH_TARGET_CSS_PX * getCanvasCssScale(canvas);
    const maxByBoxSize = Math.max(HANDLE_HIT_MIN, Math.min(box.width, box.height) * HANDLE_HIT_MAX_FRACTION_OF_BOX);
    const hitSize = clamp(touchTarget, HANDLE_HIT_MIN, maxByBoxSize);
    const positions = handlePositions(box);
    for (const key in positions) {
      const p = positions[key];
      if (Math.abs(point.x - p.x) <= hitSize / 2 && Math.abs(point.y - p.y) <= hitSize / 2) {
        return key;
      }
    }
    return null;
  }

  /** 指定した点が、範囲の形(楕円/矩形)の内側にあるかを調べる(paddingぶんだけ範囲を広げて判定できる) */
  function isPointInShape(point, shape, box, padding) {
    const pad = padding || 0;
    if (shape === 'ellipse') {
      const rx = box.width / 2 + pad;
      const ry = box.height / 2 + pad;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (point.x - (box.x + box.width / 2)) / rx;
      const ny = (point.y - (box.y + box.height / 2)) / ry;
      return nx * nx + ny * ny <= 1;
    }
    return point.x >= box.x - pad && point.x <= box.x + box.width + pad
      && point.y >= box.y - pad && point.y <= box.y + box.height + pad;
  }

  /** 指定した点の下にある範囲を探す(後から作られたものを優先) */
  function pickRegionAt(point, regions, previewScale, canvas) {
    // 指でタップしたときに縁を少し外しても選択できるよう、当たり判定に少し余裕を持たせる
    const padding = canvas ? (BODY_HIT_PADDING_CSS_PX * getCanvasCssScale(canvas)) / 2 : 0;
    for (let i = regions.length - 1; i >= 0; i--) {
      const region = regions[i];
      const box = originalBoxToCanvasBox(region, previewScale);
      if (isPointInShape(point, region.shape, box, padding)) {
        return region;
      }
    }
    return null;
  }

  /** ハンドルの種類に応じたマウスカーソルの形を返す */
  function cursorForHandle(handle) {
    if (handle === 'nw' || handle === 'se') return 'nwse-resize';
    if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
    if (handle === 'n' || handle === 's') return 'ns-resize';
    return 'ew-resize';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** ドラッグの開始点・終了点から、左上基準の矩形情報を作る */
  function rectFromPoints(start, end, shape) {
    return {
      shape,
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  /**
   * リサイズ操作で、ハンドルの種類とドラッグ量から新しいバウンディングボックスを計算する。
   * (元画像の解像度基準の座標で計算する)
   * @param {{x:number,y:number,width:number,height:number}} orig ドラッグ開始時点のボックス
   * @param {string} handle 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
   * @param {number} dx ドラッグ量(元解像度基準)
   * @param {number} dy ドラッグ量(元解像度基準)
   * @param {number} maxWidth 画像の幅(元解像度)
   * @param {number} maxHeight 画像の高さ(元解像度)
   */
  function computeResizedBox(orig, handle, dx, dy, maxWidth, maxHeight) {
    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.width;
    let bottom = orig.y + orig.height;

    if (handle.indexOf('w') !== -1) left = clamp(left + dx, 0, right - MIN_REGION_SIZE);
    if (handle.indexOf('e') !== -1) right = clamp(right + dx, left + MIN_REGION_SIZE, maxWidth);
    if (handle.indexOf('n') !== -1) top = clamp(top + dy, 0, bottom - MIN_REGION_SIZE);
    if (handle.indexOf('s') !== -1) bottom = clamp(bottom + dy, top + MIN_REGION_SIZE, maxHeight);

    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /** クライアント座標(マウス/指の位置)をcanvasのピクセル座標に変換し、canvasの範囲内に収める */
  function clientToCanvasPoint(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    // CSSで縮小表示されている場合に備えて、表示上のサイズと実ピクセル数の比率を掛ける
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: clamp((clientX - rect.left) * scaleX, 0, canvas.width),
      y: clamp((clientY - rect.top) * scaleY, 0, canvas.height),
    };
  }

  /**
   * canvas上でのポインター操作を設定し、範囲の作成・選択・移動・リサイズをできるようにする。
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} canvasWrap canvasを囲んでいる、スクロールで画像を動かせる(パンできる)枠
   * @param {() => {previewBitmap: ImageBitmap, previewScale: number, shape: 'ellipse'|'rect', fullWidth: number, fullHeight: number}|null} getState
   *   最新の状態を返すコールバック。画像が未読み込みならnullを返す。
   * @param {() => boolean} getPanMode 「画像を動かす」モード中かどうかを返すコールバック
   * @param {() => void} onChange 範囲の作成・削除など、メッセージ表示の更新が必要なときに呼ばれる
   */
  function attachInteractions(canvas, canvasWrap, getState, getPanMode, onChange) {
    // 現在進行中の操作。null | 'draw' | 'move' | 'resize' | 'pan'
    let mode = null;
    let dragStart = null; // {x, y} canvasのピクセル座標(ドラッグ開始点)
    let dragShape = null; // 'draw'モードで使う、作成中の形
    let activeId = null; // 'move'/'resize'モードで操作対象の範囲ID
    let activeHandle = null; // 'resize'モードで操作中のハンドル
    let originalBox = null; // 'move'/'resize'開始時点のボックス(元解像度基準)
    let panPointerId = null; // 'pan'モードで操作中のポインターID
    let panStart = null; // {clientX, clientY, scrollLeft, scrollTop} 'pan'開始時点の情報

    function redraw(draftRegion) {
      const state = getState();
      if (!state) return;
      render(
        canvas,
        state.previewBitmap,
        state.previewScale,
        window.App.regionStore.getRegions(),
        window.App.regionStore.getSelectedId(),
        draftRegion || null
      );
    }

    canvas.addEventListener('pointerdown', (event) => {
      const state = getState();
      if (!state) return;

      try {
        // ポインターキャプチャをしておくと、canvasの外まで指/マウスが出てもドラッグを追跡できる。
        // ただし一部の環境では失敗することがあるため、失敗してもドラッグ自体は続行する。
        canvas.setPointerCapture(event.pointerId);
      } catch (err) {
        console.warn('setPointerCaptureに失敗しました(ドラッグは続行します)', err);
      }

      // 「画像を動かす」モード中は、範囲の操作はせず、ドラッグで表示位置をスクロールするだけにする
      if (getPanMode()) {
        mode = 'pan';
        panPointerId = event.pointerId;
        panStart = {
          clientX: event.clientX,
          clientY: event.clientY,
          scrollLeft: canvasWrap.scrollLeft,
          scrollTop: canvasWrap.scrollTop,
        };
        canvas.style.cursor = ''; // 直前のカーソル指定を消し、CSSの grabbing(つかんでいる手)を効かせる
        canvas.classList.add('is-panning');
        return;
      }

      const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
      const regions = window.App.regionStore.getRegions();
      const selectedId = window.App.regionStore.getSelectedId();
      const selectedRegion = regions.find((r) => r.id === selectedId);

      // 1. 選択中の範囲のハンドルの上なら、リサイズを開始する
      if (selectedRegion) {
        const box = originalBoxToCanvasBox(selectedRegion, state.previewScale);
        const handle = hitTestHandle(point, box, canvas);
        if (handle) {
          mode = 'resize';
          activeId = selectedRegion.id;
          activeHandle = handle;
          dragStart = point;
          originalBox = { x: selectedRegion.x, y: selectedRegion.y, width: selectedRegion.width, height: selectedRegion.height };
          return;
        }
      }

      // 2. いずれかの範囲の内側なら、選択して移動を開始する
      const hit = pickRegionAt(point, regions, state.previewScale, canvas);
      if (hit) {
        const wasAlreadySelected = hit.id === selectedId;
        window.App.regionStore.select(hit.id);
        mode = 'move';
        activeId = hit.id;
        dragStart = point;
        originalBox = { x: hit.x, y: hit.y, width: hit.width, height: hit.height };
        redraw();
        // 選択している範囲が変わったときだけ、設定パネルなどを更新してもらう
        if (!wasAlreadySelected) onChange();
        return;
      }

      // 3. 何もない場所なら、選択を解除して新しい範囲の作成を開始する
      const hadSelection = selectedId !== null;
      window.App.regionStore.deselect();
      mode = 'draw';
      dragStart = point;
      dragShape = state.shape;
      redraw();
      if (hadSelection) onChange();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (mode === 'pan') {
        if (event.pointerId !== panPointerId) return;
        // ドラッグした分だけ、枠の中の表示位置(スクロール位置)を動かす
        canvasWrap.scrollLeft = panStart.scrollLeft - (event.clientX - panStart.clientX);
        canvasWrap.scrollTop = panStart.scrollTop - (event.clientY - panStart.clientY);
        return;
      }

      const state = getState();
      if (!state) return;
      const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);

      if (mode === 'draw') {
        redraw(rectFromPoints(dragStart, point, dragShape));
        return;
      }

      if (mode === 'move') {
        const dx = (point.x - dragStart.x) * state.previewScale;
        const dy = (point.y - dragStart.y) * state.previewScale;
        const newX = clamp(originalBox.x + dx, 0, state.fullWidth - originalBox.width);
        const newY = clamp(originalBox.y + dy, 0, state.fullHeight - originalBox.height);
        window.App.regionStore.updateRegion(activeId, { x: newX, y: newY });
        redraw();
        return;
      }

      if (mode === 'resize') {
        const dx = (point.x - dragStart.x) * state.previewScale;
        const dy = (point.y - dragStart.y) * state.previewScale;
        const box = computeResizedBox(originalBox, activeHandle, dx, dy, state.fullWidth, state.fullHeight);
        window.App.regionStore.updateRegion(activeId, box);
        redraw();
        return;
      }

      // 「画像を動かす」モード中は、範囲用のカーソル(十字・移動など)に書き換えない。
      // 直接指定したカーソルはCSSより優先されてしまうため、指定を消してCSSの手のひら(grab)に任せる
      if (getPanMode()) {
        canvas.style.cursor = '';
        return;
      }

      // 操作中でなければ、カーソルの形をポインターの位置に応じて変える(見た目のヒント)
      updateHoverCursor(canvas, state, point);
    });

    canvas.addEventListener('pointerup', (event) => {
      if (mode === 'pan') {
        if (event.pointerId === panPointerId) {
          mode = null;
          panPointerId = null;
          panStart = null;
          canvas.classList.remove('is-panning');
        }
        return;
      }

      if (mode === 'draw') {
        const state = getState();
        const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
        const draft = rectFromPoints(dragStart, point, dragShape);
        if (state && draft.width >= MIN_DRAG_SIZE && draft.height >= MIN_DRAG_SIZE) {
          // canvasのピクセル座標 → 元画像の解像度座標に変換してから範囲を確定する
          const region = window.App.regionStore.createRegion({
            shape: draft.shape,
            x: draft.x * state.previewScale,
            y: draft.y * state.previewScale,
            width: draft.width * state.previewScale,
            height: draft.height * state.previewScale,
          });
          // 作った直後は選択状態にして、そのままリサイズ・削除できるようにする
          window.App.regionStore.select(region.id);
          onChange();
        }
      }

      mode = null;
      dragStart = null;
      activeId = null;
      activeHandle = null;
      originalBox = null;
      redraw();
    });

    canvas.addEventListener('pointercancel', () => {
      mode = null;
      dragStart = null;
      activeId = null;
      activeHandle = null;
      originalBox = null;
      panPointerId = null;
      panStart = null;
      canvas.classList.remove('is-panning');
      redraw();
    });
  }

  /** ドラッグ中でないときに、マウス位置に応じてカーソルの形を更新する */
  function updateHoverCursor(canvas, state, point) {
    const regions = window.App.regionStore.getRegions();
    const selectedId = window.App.regionStore.getSelectedId();
    const selectedRegion = regions.find((r) => r.id === selectedId);

    if (selectedRegion) {
      const box = originalBoxToCanvasBox(selectedRegion, state.previewScale);
      const handle = hitTestHandle(point, box, canvas);
      if (handle) {
        canvas.style.cursor = cursorForHandle(handle);
        return;
      }
    }

    const hit = pickRegionAt(point, regions, state.previewScale, canvas);
    canvas.style.cursor = hit ? 'move' : 'crosshair';
  }

  window.App.canvasView = { render, attachInteractions };
})();
