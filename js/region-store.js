// 範囲(選択範囲)のリストを管理するファイル。
// 「範囲のリスト」は配列で持ち、変更のたびに新しい配列を作って差し替える(既存の配列は書き換えない)。
// こうしておくと、あとでUndo機能を足すときに「過去の配列をスタックに積んでおく」だけで実現できる。
window.App = window.App || {};

(function () {
  'use strict';

  let regions = [];
  let selectedId = null;
  let nextNumber = 1;

  /** 加工の強さの初期値を、範囲のサイズから自動計算する。
   *  「顔や文字が判別できない強さ」を目安に、短い方の辺を基準に決める。 */
  function computeDefaultStrength(width, height) {
    const shortSide = Math.min(width, height);
    return Math.max(15, Math.round(shortSide * 0.15));
  }

  /** 縁のなじませ(フェザー)幅の初期値 */
  function computeDefaultFeather(width, height) {
    const shortSide = Math.min(width, height);
    return Math.max(4, Math.round(shortSide * 0.06));
  }

  /**
   * 範囲を新しく作り、リストに追加する。
   * @param {{shape: 'ellipse'|'rect', x: number, y: number, width: number, height: number}} params
   *   位置・サイズは元画像の解像度基準(左上が原点)
   * @returns {object} 作成した範囲
   */
  function createRegion(params) {
    const region = {
      id: 'region-' + (nextNumber++),
      shape: params.shape,
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
      // 加工の種類・強さは今後の機能で編集できるようにする(今はまだ加工処理自体は行わない)
      effect: 'blur',
      strength: computeDefaultStrength(params.width, params.height),
      feather: computeDefaultFeather(params.width, params.height),
      color: '#000000',
    };
    regions = regions.concat([region]);
    return region;
  }

  /**
   * 指定したIDの範囲に、位置・サイズなどの変更をまとめて反映する。
   * @param {string} id
   * @param {object} changes 変更したいプロパティだけを含むオブジェクト(例: {x, y})
   */
  function updateRegion(id, changes) {
    regions = regions.map((region) => (region.id === id ? Object.assign({}, region, changes) : region));
  }

  /** 指定したIDの範囲をリストから削除する */
  function removeRegion(id) {
    regions = regions.filter((region) => region.id !== id);
    if (selectedId === id) {
      selectedId = null;
    }
  }

  /** 現在の範囲のリストを返す */
  function getRegions() {
    return regions;
  }

  /** 範囲を選択状態にする */
  function select(id) {
    selectedId = id;
  }

  /** 選択を解除する */
  function deselect() {
    selectedId = null;
  }

  /** 現在選択されている範囲のID(なければnull) */
  function getSelectedId() {
    return selectedId;
  }

  /** 画像を開き直したときなどに、リストと選択状態を空にする */
  function clear() {
    regions = [];
    selectedId = null;
  }

  window.App.regionStore = {
    createRegion,
    updateRegion,
    removeRegion,
    getRegions,
    select,
    deselect,
    getSelectedId,
    clear,
  };
})();
