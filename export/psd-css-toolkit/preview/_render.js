
const fs=require('fs'), path=require('path');
const R=require(process.argv[2]);
const schema=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const mode=process.argv[4]||'design';
const data=R.sampleData(schema, mode);
process.stdout.write(JSON.stringify({html:R.render(schema,data,{})}));
