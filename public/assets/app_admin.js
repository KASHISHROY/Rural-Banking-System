
let adminToken = null;
document.getElementById('btnAdminLogin').addEventListener('click', async (e)=>{
  e.preventDefault();
  const pin = document.getElementById('adminPin').value;
  const role = document.getElementById('adminRole').value;
  const resp = await fetch('/api/admin/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pin,role})});
  const data = await resp.json();
  if(data.token){ adminToken = data.token; document.getElementById('adminMsg').textContent = 'Welcome, '+data.role; document.getElementById('dashboard').style.display='block'; loadTransactions(); loadAudit(); loadAnalytics(); }
  else document.getElementById('adminMsg').textContent = data.error || 'Login failed';
});

async function loadTransactions(){
  const resp = await fetch('/api/transactions', {headers:{'x-auth-token':adminToken}});
  const data = await resp.json();
  const tbody = document.querySelector('#txnTable tbody');
  tbody.innerHTML = '';
  data.rows.forEach(r=>{
    const tr = document.createElement('tr');
    const badge = r.status === 'safe' ? '<span class="badge badge-safe">Safe</span>' : r.status === 'fraudulent' ? '<span class="badge badge-fraud">Fraud</span>' : r.status === 'offline' ? '<span class="badge badge-offline">Offline</span>' : '<span class="badge">'+r.status+'</span>';
    tr.innerHTML = `<td>${r.id}</td><td>${r.userId}</td><td>₹${r.amount}</td><td>${r.category}</td><td>${badge}</td><td>${r.deviceId}/${r.village}</td><td>${r.timestamp}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('btnSync').addEventListener('click', async (e)=>{
  e.preventDefault();
  const resp = await fetch('/api/offline/sync', {method:'POST', headers:{'x-auth-token':adminToken}});
  const data = await resp.json();
  if(resp.ok){ alert('Sync complete'); loadTransactions(); loadAudit(); loadAnalytics(); }
  else alert(data.error || 'Sync failed');
});

async function loadAudit(){
  const resp = await fetch('/api/audit', {headers:{'x-auth-token':adminToken}});
  const data = await resp.json();
  const box = document.getElementById('auditTrail');
  box.innerHTML = '';
  data.rows.forEach(a=>{ const d = document.createElement('div'); d.style.padding='6px'; d.style.borderBottom='1px solid #f0f0f0'; d.innerHTML = `<div>${a.event}</div><div style="font-size:0.8rem;color:#666">${a.ts}</div>`; box.appendChild(d); });
}

async function loadAnalytics(){
  const resp = await fetch('/api/analytics', {headers:{'x-auth-token':adminToken}});
  const data = await resp.json();
  const labels = data.rows.map(r=>r.category);
  const totals = data.rows.map(r=>r.cnt);
  const frauds = data.rows.map(r=>r.frauds);
  const ctx = document.getElementById('chart').getContext('2d');
  new Chart(ctx, {type:'bar', data:{labels, datasets:[{label:'Total', data:totals},{label:'Fraud', data:frauds}]}, options:{responsive:true}});
}

// Export CSV
document.getElementById('btnExport').addEventListener('click', async (e)=>{
  const resp = await fetch('/api/transactions', {headers:{'x-auth-token':adminToken}});
  const data = await resp.json();
  const rows = data.rows;
  let csv = 'id,userId,amount,category,status,deviceId,village,timestamp\n';
  rows.forEach(r=>{ csv += `${r.id},${r.userId},${r.amount},${r.category},${r.status},${r.deviceId},${r.village},${r.timestamp}\n`; });
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'transactions.csv'; a.click();
});
