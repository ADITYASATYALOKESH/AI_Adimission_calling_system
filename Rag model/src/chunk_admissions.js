const fs = require('fs');
const path = require('path');

function getingmd(patth){
    let result=[]
    const items=fs.readdirSync(patth);
    for (let i of items){
        const full=path.join(patth,i);
        // console.log(full)
        if (fs.statSync(full).isDirectory()){
            result.push(...getingmd(full));
        }
        else if (i.endsWith('.md')){
            result.push(full.replace(/\\/g, '/'));
        }
    }
    return result;
}
function chunkfile(patth){
    const data=fs.readFileSync(patth,'utf-8');
    const sect=data.split("\n## ");
    const category=path.basename(path.dirname(patth));
    const source=path.basename(patth,'.md');
    // console.log(source);
    const chunks=[];
    sect.slice(1).forEach((item,index)=>{
        const line=item.split('\n');
        const head=line[0].trim();
        const body=line.slice(1).join('\n').trim();
        if (!body) return;
        const chunkText=`${head}\n${body}`;
        const wordCount=chunkText.split(/\s+/).length;
        chunks.push({
            chunkId: `${category}_${source}_${index}`,
            text: chunkText,
            metadata: {
                source,
                category,
                patth,
                head,
                chunkIndex:  index,
                wordCount,
                lastUpdated: "2026-03"
            }
        });
    })
    return chunks;
}

function run() {
  const kbPath   = 'knowledge_base';
  const outDir   = 'chunks';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const allFiles =getingmd(kbPath);
  const byCategory = {};
  for (const file of allFiles) {
    const category = path.basename(path.dirname(file));
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(file);
  }
  let grandTotal = 0;
  for (const [category, files] of Object.entries(byCategory)) {
    const allChunks = [];

    for (const file of files) {
      const chunks =chunkfile(file);
      allChunks.push(...chunks);
    }
    const outPath = path.join(outDir, `${category}_chunks.json`);
    fs.writeFileSync(outPath, JSON.stringify(allChunks, null, 2));
    const avgWords = Math.round(
      allChunks.reduce((s, c) => s + c.metadata.wordCount, 0)
      / allChunks.length
    );

    // console.log(
    //   `✅ ${category.padEnd(15)} → ${String(allChunks.length).padStart(3)} chunks | Avg: ${avgWords} words`
    // );
    grandTotal += allChunks.length;
  }

  console.log('─'.repeat(50));
  console.log(`📦 Total: ${grandTotal} chunks saved to /${outDir}`);
}

run();
// console.log(getingmd('knowledge_base'));