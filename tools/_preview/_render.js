
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=process.argv[2], id=process.argv[3];
const override=process.argv[4]?JSON.parse(fs.readFileSync(process.argv[4],'utf8')):{};
const registered={};const stub=()=>({appendChild(){},setAttribute(){},style:{},textContent:'',id:''});
const sb={console:{error(){},warn(){},log(){}},BNCore:{registerBlock:b=>registered[b.id]=b},
 document:{getElementById:()=>null,createElement:stub,head:stub(),body:stub()}};
sb.window=sb;vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT,'JS/render-config.js'),'utf8'),sb);
vm.runInContext(fs.readFileSync(path.join(ROOT,'core/schema-renderer.js'),'utf8'),sb);
const s=JSON.parse(fs.readFileSync(path.join(ROOT,'blocks',id,'block.json'),'utf8'));
sb.BNSchemaRenderer.registerFromSchema(s);
const d={};(registered[id].fields||[]).forEach(f=>d[f.key]=f.type==='image'?'':(f.default||''));
Object.keys(override).forEach(k=>{d[k]=override[k];});
process.stdout.write(JSON.stringify({w:s.width,h:s.height,ref:s.refImage,
  html:registered[id].render(d,{editable:false})}));
