import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function moduleUrl(name) {
  let source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  for (const match of [...source.matchAll(/import (\w+) from "\.\/(.+\.json)";/g)]) {
    source = source.replace(match[0], `const ${match[1]} = ${await readFile(new URL(`../src/${match[2]}`, import.meta.url), 'utf8')};`);
  }
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...js.matchAll(/from "\.\/(.*?)"/g)]) js = js.replace(match[0], `from "${await moduleUrl(match[1])}"`);
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const { loadGoogleSheetData, dashboardForMonth } = await import(await moduleUrl('google-sheet-data'));
test('loads all four sales months even when the GViz view only includes November', async (t) => {
  const csv = process.env.SALES_CSV ? await readFile(process.env.SALES_CSV, 'utf8') : 'Sales Date,Shop Code,Shop Name,Brand,Qty,Net Amount\n2026-08-31,80100478,Terminal 21,IPHONE,1,100\n2026-09-30,80100478,Terminal 21,IPHONE,2,200\n2026-10-31,80100478,Terminal 21,IPHONE,3,300\n2026-11-03,80100478,Terminal 21,IPHONE,4,400';
  t.mock.method(console, 'warn', () => {});
  const requested = [];
  const host = { setTimeout, clearTimeout };
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(url);
    return { ok: true, text: async () => new URL(url).searchParams.get('gid') === '892853742' ? csv : 'Sales Date,Shop Code,Shop Name,Brand,Model,Qty,Net Amount\n' };
  });
  globalThis.window = host;
  globalThis.document = {
    createElement: () => ({remove(){}}),
    head: { appendChild(script) {
      const url = new URL(script.src);
      const cb = url.searchParams.get('tqx').split('responseHandler:')[1];
      const sales = url.searchParams.get('gid') === '892853742';
      const stock = url.searchParams.get('sheet') === 'Data Stock';
      const headers = sales ? ['Sales Date','Shop Code','Shop Name','Brand','Qty','Net Amount'] : ['Shop Code','Shop Name','Brand','Target Qty','Target Net Amount'];
      const values = sales ? ['2026-11-03','80100478','Terminal 21','IPHONE',4,400] : ['80100478','Terminal 21','IPHONE',10,1000];
      queueMicrotask(() => host[cb]({status:'ok',table:{cols: stock ? [] : headers.map(label=>({label})),rows:stock ? [] : [{c:values.map(v=>({v}))}]}}));
    }}
  };
  try {
    const data = await loadGoogleSheetData();
    assert.ok(requested.some(url => url.includes('/export?') && url.includes('gid=892853742')));
    const expected = process.env.SALES_CSV ? [[2437,59057797],[3440,111301204],[3469,123773773],[310,9695115]] : [[1,100],[2,200],[3,300],[4,400]];
    for (const [i, month] of ['2026-08','2026-09','2026-10','2026-11'].entries()) {
      const dataMonth = dashboardForMonth(data,month);
      const totals = [dataMonth.totals.dailyQty.reduce((a,b)=>a+b,0),dataMonth.totals.dailyNet.reduce((a,b)=>a+b,0)];
      assert.deepEqual(totals,expected[i]);
      console.log(month,totals);
    }
  } finally { delete globalThis.window; delete globalThis.document; }
});
