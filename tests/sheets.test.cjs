const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function load(file,google){
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  const req=name=>name==='./google'?{sheetsClient:()=>google}:name==='./sheet-write'?load('lib/sheet-write.ts',google):require(name);
  vm.runInNewContext(code,{module,exports:module.exports,require:req,process:{env:{SPREADSHEET_ID:'src'}},console:{log(){},warn(){},error(){}},setTimeout,Date});
  return module.exports;
}
const row=(phone,name='Name')=>['2026/10/13 12:00:00','','','','','',name,'2000-01-01','',phone,'','','','','','',''];
function mockSheets(seed={}){
  const ids={src:0,'1XrGfX7JMiGPpa2ICd1pWrkDrHvd4hFzZoIsdxzCvqas':1};
  const rows={src:[['header'],...(seed.src||[])],dest:[['header'],...(seed.dest||[])]};
  const calls=[];
  const data=id=>rows[id==='src'?'src':'dest'];
  const api={spreadsheets:{
    get:async ({spreadsheetId})=>({data:{sheets:[{properties:{title:'顧客データDB',sheetId:ids[spreadsheetId]}}]}}),
    values:{
      get:async args=>{
        calls.push(['get',args]); const r=data(args.spreadsheetId), range=args.range.split('!')[1];
        if(range==='A:A') return {data:{values:r.map(x=>[x[0]])}};
        if(range==='J2:J') return {data:{values:r.slice(1).map(x=>[x[9]])}};
        if(/^J\d+$/.test(range)) return {data:{values:[[r[+range.slice(1)-1]?.[9]]]}};
        throw Error('Unexpected range '+range);
      },
      update:async args=>{
        calls.push(['update',args]); const m=/!M(\d+):O\d+/.exec(args.range);
        assert.ok(m,'A:Q must be written in the insertion batch');
        const target=data(args.spreadsheetId)[+m[1]-1];
        args.requestBody.values[0].forEach((v,i)=>target[i+12]=v);
        return {data:{}};
      },
    },
    batchUpdate:async (args,opts)=>{
      calls.push(['batch',args,opts]); const r=data(args.spreadsheetId);
      // The server applies one complete batch before the next batch.
      for(const request of args.requestBody.requests){
        if(request.insertDimension) r.splice(request.insertDimension.range.startIndex,0,[]);
        if(request.updateCells){const u=request.updateCells;r[u.start.rowIndex]=u.rows[0].values.map(c=>c.userEnteredValue.stringValue??c.userEnteredValue.numberValue);}
      }
      return {data:{}};
    },
  }};
  return {api,rows,calls};
}

test('old split insert/write loses one customer under overlapping requests',()=>{
  const rows=[['header']];
  rows.splice(1,0,[]); // A insert
  rows.splice(1,0,[]); // B insert
  rows[1]=row('09011111111','A');
  rows[1]=row('09022222222','B');
  assert.equal(rows.filter(r=>r[9]).length,1);
});
for(const target of ['src','dest']) test(`simultaneous ${target} inserts retain both customers`,async()=>{
  const m=mockSheets(), s=load('lib/sheets.ts',m.api);
  const send=target==='src'?s.writeNewRow:s.transferToIS;
  await Promise.all([send({phone:'09011111111',fullName:'A'}),send({phone:'09022222222',fullName:'B'})]);
  assert.deepEqual(m.rows[target].slice(1).map(r=>r[9]).sort(),['09011111111','09022222222']);
  for(const [type,args,opts] of m.calls) if(type==='batch'){
    assert.equal(args.requestBody.requests.length,2);
    assert.equal(opts.retry,false); // Never blindly replay an insert after an ambiguous response.
    assert.equal(args.requestBody.requests[1].updateCells.rows[0].values.length,17);
  }
});

test('final IS submission updates the existing row and preserves operator columns',async()=>{
  const existing=row('09011111111'); existing[17]='operator-owned';
  const m=mockSheets({dest:[existing]}),s=load('lib/sheets.ts',m.api);
  await s.transferToIS({phone:'09011111111',interviewDateTime1:'10/14 12:00'},{mode:'update'});
  assert.equal(m.rows.dest.length,2); assert.equal(m.rows.dest[1][12],'10/14 12:00'); assert.equal(m.rows.dest[1][17],'operator-owned');
});
test('repeated first submission does not clear completed interview data',async()=>{
  const existing=row('09011111111'); existing[12]='10/14 12:00';
  const m=mockSheets({dest:[existing]}),s=load('lib/sheets.ts',m.api);
  await s.transferToIS({phone:'09011111111'});
  assert.equal(m.rows.dest.length,2); assert.equal(m.rows.dest[1][12],'10/14 12:00');
});
test('lookup finds a customer older than the last 500 rows',async()=>{
  const m=mockSheets({dest:[row('09011111111'),...Array.from({length:600},(_,i)=>row('x'+i))]}),s=load('lib/sheets.ts',m.api);
  await s.transferToIS({phone:'09011111111',interviewDateTime1:'new'},{mode:'update'});
  assert.equal(m.rows.dest.length,602);assert.equal(m.rows.dest[1][12],'new');
});
test('shifted source row hint cannot update a different customer',async()=>{
  const m=mockSheets({src:[row('09022222222'),row('09011111111')]}),s=load('lib/sheets.ts',m.api);
  await s.updateRow(2,{phone:'09011111111',interviewDateTime1:'new'});
  assert.equal(m.rows.src[1][12],'');assert.equal(m.rows.src[2][12],'new');
});
test('missing source phone fails without overwriting the hinted row',async()=>{
  const m=mockSheets({src:[row('09022222222')]}),s=load('lib/sheets.ts',m.api);
  await assert.rejects(s.updateRow(2,{phone:'09011111111'}));
  assert.equal(m.calls.filter(c=>c[0]==='update').length,0);
});
test('phone variants match while distinct numbers stay distinct',()=>{
  const s=load('lib/sheet-write.ts');
  for(const p of ['090-1111-1111','０９０１１１１１１１１','+819011111111',9011111111])assert.equal(s.normalizePhone(p),'09011111111');
  assert.notEqual(s.normalizePhone('09011111111'),s.normalizePhone('09011111112'));
});
test('atomic payload preserves typed dates and phone zeros without writing R+',()=>{
  const s=load('lib/sheet-write.ts'),req=s.insertRowRequests(0,1,row('09011111111'));
  const values=req[1].updateCells.rows[0].values;
  assert.equal(values[0].userEnteredValue.numberValue,46308.5);
  assert.equal(values[7].userEnteredValue.numberValue,36526);
  assert.equal(values[9].userEnteredValue.stringValue,'09011111111');
  assert.equal(values.length,17);assert.equal(req[0].insertDimension.inheritFromBefore,true);
});
