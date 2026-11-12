from pathlib import Path
p = Path('E:/GitHub/shopee/js/layout-runtime.js')
with p.open('r', encoding='utf-8', newline='') as f:
    s = f.read()
nl = '\r\n' if '\r\n' in s else '\n'
changes = [
    ('''        if(oldImg && oldImg.getAttribute('src') !== e.data.src){
          if(e.data.productRect){''', '''        if(oldImg && oldImg.getAttribute('src') !== e.data.src){
          oldBox._bnImageUpdateSeq = (oldBox._bnImageUpdateSeq || 0) + 1;
          if(e.data.productRect){'''),
    ('''      if(boxU){
        if(e.data.rotate''', '''      if(boxU){
        var imageUpdateSeq = (boxU._bnImageUpdateSeq || 0) + 1;
        boxU._bnImageUpdateSeq = imageUpdateSeq;
        if(e.data.rotate'''),
    ('''            tmpU.onload = function(){
              var prNew''', '''            tmpU.onload = function(){
              if(boxU._bnImageUpdateSeq !== imageUpdateSeq) return;
              var prNew'''),
    ('''              var applyRotatedFrame = function(){
                if(nw > 0''', '''              var applyRotatedFrame = function(){
                if(boxU._bnImageUpdateSeq !== imageUpdateSeq) return;
                if(nw > 0'''),
    ('''            tmpU.onerror = function(){
              imgU.onload''', '''            tmpU.onerror = function(){
              if(boxU._bnImageUpdateSeq !== imageUpdateSeq) return;
              imgU.onload'''),
]
for before, after in changes:
    before, after = before.replace('\n',nl), after.replace('\n',nl)
    assert s.count(before) == 1, before[:100]
    s = s.replace(before,after)
with p.open('w', encoding='utf-8', newline='') as f:
    f.write(s)
