const DEFAULT_AWS_URL = 'https://weu74viubx6gzhx2274vgereme0jnree.lambda-url.ap-southeast-2.on.aws';
const lambdaInput = document.getElementById('aws-lambda-url');
const saveBtn = document.getElementById('save-btn');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');

chrome.storage.local.get(['awsLambdaUrl'], (stored) => {
  const url = (stored.awsLambdaUrl || DEFAULT_AWS_URL).replace(/\/+$/, '');
  lambdaInput.value = url;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3500);
  fetch(`${url}/health`, { signal: ctrl.signal })
    .then((r) => { clearTimeout(t); return r.json(); })
    .then((d) => {
      statusBadge.className = 'status-badge status-online';
      statusBadge.textContent = '● AWS Lambda Proxy Online';
      statusText.innerHTML = `Server Key Configured: <code>${d.keyConfigured ? 'Yes (' + (d.keyMasked || 'Protected') + ')' : 'Check AWS Env'}</code>`;
    })
    .catch(() => {
      clearTimeout(t);
      statusBadge.className = 'status-badge status-direct';
      statusBadge.textContent = '● AWS Lambda Endpoint Set';
      statusText.innerHTML = `Routing all extension requests through:<br/><code>${url}</code>`;
    });
});

saveBtn.addEventListener('click', () => {
  const cleanUrl = (lambdaInput.value.trim() || DEFAULT_AWS_URL).replace(/\/+$/, '');
  chrome.storage.local.set({ awsLambdaUrl: cleanUrl }, () => {
    saveBtn.textContent = 'Saved!';
    setTimeout(() => { saveBtn.textContent = 'Save Endpoint'; }, 1200);
  });
});
