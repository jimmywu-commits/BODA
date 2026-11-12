from pathlib import Path

root = Path('E:/GitHub/shopee')

def edit(relative, replacements):
    p = root / relative
    with p.open('r', encoding='utf-8', newline='') as f:
        source = f.read()
    newline = '\r\n' if '\r\n' in source else '\n'
    for before, after, count in replacements:
        before = before.replace('\n', newline)
        after = after.replace('\n', newline)
        actual = source.count(before)
        if actual != count:
            raise ValueError(f'{relative}: expected {count}, found {actual}: {before[:100]}')
        source = source.replace(before, after)
    with p.open('w', encoding='utf-8', newline='') as f:
        f.write(source)

edit('js/layout-runtime.js', [
    ('''      if(oldBox){
        if(oldBox._bnRO){ try{ oldBox._bnRO.disconnect(); }catch(_){ } }
        oldBox.remove();
      }''', '''      if(oldBox){
        /* ready／素材重播不是重新排品。同 id 沿用畫布當下的框與編輯結果，
           只有圖片真的不同才就地換像素；完整還原會先明確移除舊商品。 */
        var oldImg = oldBox.querySelector('img');
        if(oldImg && oldImg.getAttribute('src') !== e.data.src){
          if(e.data.productRect){
            oldBox.dataset.productRect = JSON.stringify(e.data.productRect);
            oldBox.dataset.ratio = String(e.data.productRect.w / Math.max(1,e.data.productRect.h));
          }else{
            delete oldBox.dataset.productRect;
            oldBox.dataset.ratio = String(e.data.ratio || 1);
          }
          oldBox.dataset.imageRatio = String(e.data.ratio || 1);
          if(e.data.rotate !== undefined) oldBox.dataset.rotate = String(Number(e.data.rotate) || 0);
          oldImg.onload = function(){ bnProductImgLoaded(oldImg); };
          oldImg.src = e.data.src;
        }
        bnRelayoutProductBox(oldBox);
        return;
      }''', 1),
    ('''      var cbox = createCharBox(slotKey, e.data, czone);''', '''      var currentChar = czone.querySelector('.bn-char-box[data-slot="'+slotKey+'"]');
      if(currentChar && currentChar.dataset.id === String(e.data.id)){
        /* 更換人物／重播同一人物只換圖片，不重建框，也不套回較早的快照。 */
        currentChar.dataset.ratio = String(e.data.ratio || 1);
        currentChar.dataset.aboveMain = e.data.aboveMain !== false ? '1' : '0';
        var currentCharImg = currentChar.querySelector('img');
        if(currentCharImg && currentCharImg.getAttribute('src') !== e.data.src) currentCharImg.src = e.data.src;
        syncCharGradientOverlay(currentChar);
        applyCharacterZ();
        setTimeout(function(){ postCharacterLayout(currentChar,{snapshotOnly:true}); },0);
        return;
      }
      var cbox = createCharBox(slotKey, e.data, czone);''', 1),
    ('''      setTimeout(postAllProductLayouts, 0);''', '''      setTimeout(function(){ postAllProductLayouts({snapshotOnly:true}); }, 0);''', 1),
    ('''    setTimeout(postAllProductLayouts, 0);''', '''    setTimeout(function(){ postAllProductLayouts({snapshotOnly:true}); }, 0);''', 1),
    ('''    positions.forEach(function(p, i){
      var saved = null;''', '''    positions.forEach(function(p, i){
      /* 已編輯框使用目前設計座標；新增／重播其他物件不可重新 clamp、
         改高寬或覆寫 display/z-index。savedLayout 僅在首次還原時套用。 */
      if(p.box.dataset.manualLayout === '1' && !p.box.dataset.savedLayout){
        var currentW = parseFloat(p.box.style.width), currentH = parseFloat(p.box.style.height);
        if(currentW > 0 && currentH > 0){ bnRelayoutProductBox(p.box); return; }
      }
      var saved = null;''', 1),
    ('''      var height = br.height / scaleY;
      var data = {''', '''      var height = br.height / scaleY;
      /* 人物的可見度規則或跨頁隱藏會讓 DOM rect 變成零；仍以框的設計
         座標存檔，避免零尺寸快照毀掉商品，或透過鎖鏈傳給其他版位。 */
      if(!(br.width > 0 && br.height > 0 && zr.width > 0 && zr.height > 0)){
        left = parseFloat(box.style.left); top = parseFloat(box.style.top);
        width = parseFloat(box.style.width); height = parseFloat(box.style.height);
      }
      if(!isFinite(left) || !isFinite(top) || !(width > 0) || !(height > 0)) return;
      var data = {''', 1),
    ('''      var left=(br.left-zr.left)/sx,top=(br.top-zr.top)/sy,width=br.width/sx,height=br.height/sy;
      var data = {''', '''      var left=(br.left-zr.left)/sx,top=(br.top-zr.top)/sy,width=br.width/sx,height=br.height/sy;
      if(!(br.width > 0 && br.height > 0 && zr.width > 0 && zr.height > 0)){
        left=parseFloat(box.style.left);top=parseFloat(box.style.top);
        width=parseFloat(box.style.width);height=parseFloat(box.style.height);
      }
      if(!isFinite(left)||!isFinite(top)||!(width>0)||!(height>0))return;
      var data = {''', 1),
])

edit('js/bn-editor-plugin.js', [
    ('''              layouts: {} /* 換圖重設手動位置，改回預設：商品範圍右側 1/3 寬、高度 auto */''', '''              /* 換人物沿用各版位的框；圖片使用 contain，維持比例且不影響商品。 */
              layouts: prevSlot && prevSlot.layouts ? prevSlot.layouts : {}''', 1),
])

edit('index.html', [('20261111-perf2', '20261111-image-state1', 6)])
for p in (root / 'html').glob('*.html'):
    if '20261111-perf2' in p.read_text(encoding='utf-8'):
        edit(str(p.relative_to(root)), [('20261111-perf2', '20261111-image-state1', 1)])
