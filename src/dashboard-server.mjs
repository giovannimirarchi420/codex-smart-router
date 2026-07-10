import { createServer } from 'node:http';
import { readAuditStats } from './audit.mjs';
import { buildDashboard } from './dashboard.mjs';

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex Smart Router</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0c1020;color:#edf1ff;font:15px ui-sans-serif,system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:36px 22px}h1{margin:0;font-size:28px}p{color:#aab4d4}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:24px 0}.card{background:#151b31;border:1px solid #293354;border-radius:14px;padding:18px}.label{color:#9eabd0;font-size:13px}.info{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid #7180ad;border-radius:50%;font-size:11px;cursor:help}.value{font-size:27px;font-weight:700;margin-top:7px}.panel{background:#151b31;border:1px solid #293354;border-radius:14px;padding:20px;margin:14px 0}h2{font-size:16px;margin:0 0 6px}.bars{display:grid;gap:11px}.bar-row{display:grid;grid-template-columns:150px 1fr 52px;gap:10px;align-items:center}.track{height:10px;background:#242d4b;border-radius:99px;overflow:hidden}.fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#70e3c2,#728cff)}.note{font-size:13px;color:#aab4d4}@media(max-width:550px){.bar-row{grid-template-columns:105px 1fr 42px}}
</style></head><body><main><h1>Codex Smart Router</h1><p id="subtitle">Loading private local audit data…</p><section id="cards" class="grid"></section><section class="panel"><h2>Model distribution</h2><div id="models" class="bars"></div></section><section class="panel"><h2>Routing distribution</h2><div id="tiers" class="bars"></div></section><p class="note" id="note"></p></main><script>
const money=v=>v==null?'Needs price mapping':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(v).replace('$','USD ');
const number=v=>new Intl.NumberFormat().format(v||0);
function bars(id,values){const node=document.querySelector(id),entries=Object.entries(values||{}),max=Math.max(...entries.map(([,v])=>v),1);node.innerHTML=entries.length?entries.map(([name,value])=>'<div class="bar-row"><span>'+name+'</span><div class="track"><div class="fill" style="width:'+(value/max*100)+'%"></div></div><b>'+value+'</b></div>').join(''):'No data yet.'}
async function load(){const d=await fetch('/api/dashboard').then(r=>r.json()),e=d.estimate,c=[['Turns','Completed usage records',number(d.usage.turns)],['Tokens processed','Input + output + reasoning tokens',number(d.usage.totalTokens)+' tokens'],['Routing coverage','Routes handled by a selected tier',d.convenience.routingCoveragePercent.toFixed(1)+'%'],['Classifier overhead','Average classifier latency per turn',Math.round(d.convenience.classifierOverheadMsPerTurn)+' ms/turn'],['Estimated savings vs '+e.baselineModel,'Estimated API cost difference',money(e.estimatedSavings)],['Routed cost','Estimated total API cost',money(e.routedCost)]];document.querySelector('#cards').innerHTML=c.map(([l,i,v])=>'<article class="card" title="'+i+'"><div class="label">'+l+' <span class="info" aria-label="'+i+'">i</span></div><div class="value">'+v+'</div></article>').join('');document.querySelector('#subtitle').textContent='Last refresh: '+new Date().toLocaleTimeString()+' · tokens are raw token units';document.querySelector('#note').textContent=e.note;bars('#models',d.models);bars('#tiers',d.tiers)}load();setInterval(load,15000);
</script></body></html>`;

export async function startDashboardServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const pricing = options.pricing;
  const baselineModel = options.baselineModel;
  const auditPath = options.auditPath;
  const server = createServer(async (request, response) => {
    if (request.url === '/api/dashboard') {
      try {
        const stats = await readAuditStats(auditPath);
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(buildDashboard(stats, { pricing, baselineModel })));
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(PAGE);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address();
  return { server, url: `http://${host}:${address.port}` };
}
