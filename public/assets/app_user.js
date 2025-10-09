
let sessionToken = null;
document.getElementById('btnRequestOtp').addEventListener('click', async (e)=>{
  e.preventDefault();
  const userId = document.getElementById('userId').value;
  const resp = await fetch('/api/auth/request-otp', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId})});
  const data = await resp.json();
  document.getElementById('authMsg').textContent = 'OTP sent (for prototype only): ' + data.otp;
});
document.getElementById('btnVerify').addEventListener('click', async (e)=>{
  e.preventDefault();
  const userId = document.getElementById('userId').value;
  const pin = document.getElementById('pin').value;
  const otp = document.getElementById('otp').value;
  const resp = await fetch('/api/auth/verify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId,pin,otp})});
  const data = await resp.json();
  if(data.token){ sessionToken = data.token; document.getElementById('authMsg').textContent = 'Authenticated'; document.getElementById('txnCard').style.display='block'; initDevice(); }
  else{ document.getElementById('authMsg').textContent = data.error || 'Auth failed'; }
});

function initDevice(){
  let did = localStorage.getItem('demo_device_id');
  let vid = localStorage.getItem('demo_village_code');
  if(!did){ did = 'DEV-'+Math.random().toString(36).slice(2,9); localStorage.setItem('demo_device_id', did); }
  if(!vid){ vid = 'VIL-'+String(Math.floor(100+Math.random()*900)); localStorage.setItem('demo_village_code', vid); }
  document.getElementById('deviceId').value = did;
  document.getElementById('village').value = vid;
}

document.getElementById('btnSendTxn').addEventListener('click', async (e)=>{
  e.preventDefault();
  if(!sessionToken){ document.getElementById('txnMsg').textContent='Authenticate first'; return; }
  const amount = Number(document.getElementById('amount').value);
  const category = document.getElementById('category').value;
  const deviceId = document.getElementById('deviceId').value;
  const village = document.getElementById('village').value;
  const offline = document.getElementById('offline').checked;
  const userId = document.getElementById('userId').value;
  const resp = await fetch('/api/transaction', {
    method:'POST', headers:{'Content-Type':'application/json','x-auth-token':sessionToken},
    body: JSON.stringify({ userId, amount, category, deviceId, village, offline })
  });
  const data = await resp.json();
  if(resp.ok){ document.getElementById('txnMsg').textContent = 'Transaction: '+ (data.status||'unknown'); }
  else{ document.getElementById('txnMsg').textContent = data.error || 'Error'; }
});
