const DEFAULTS = {
  enabled: true,
  hideSponsored: true,
  exactMatch: true,
  dedupe: true,
  blacklist: '',
};

const CHECKBOXES = ['enabled', 'hideSponsored', 'exactMatch', 'dedupe'];
const TEXTS = ['blacklist'];

// Qual interruptor comanda cada estágio da cadeia. Os que não aparecem aqui não têm
// liga/desliga: valem sempre que estão preenchidos.
const TOGGLE_DO_MOTIVO = {
  patrocinados: 'hideSponsored',
  'fora da busca': 'exactMatch',
  duplicados: 'dedupe',
};

const el = (id) => document.getElementById(id);
const stages = [...document.querySelectorAll('.stage')];

// Chamar sem argumento repinta com as últimas contagens conhecidas — mexer num
// interruptor não pode zerar os números enquanto a aba não responde de novo.
let ultimasContagens = null;

const pintarEstagios = (contagens) => {
  if (contagens !== undefined) ultimasContagens = contagens;
  const ligado = el('enabled').checked;
  document.body.classList.toggle('off', !ligado);

  for (const stage of stages) {
    const motivo = stage.dataset.motivo;
    const toggle = TOGGLE_DO_MOTIVO[motivo];
    const agindo = ligado && (!toggle || el(toggle).checked);
    stage.classList.toggle('acting', agindo);

    const n = ultimasContagens ? ultimasContagens.get(motivo) || 0 : 0;
    stage.querySelector('.count').textContent = n;
    stage.classList.toggle('caught', n > 0);
  }
};

// Pergunta à aba ativa o que ela classificou. Sem resposta (aba fora do Marketplace,
// página ainda carregando), o popup esconde a coluna de números.
const atualizarContagens = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return pintarEstagios(null);
    chrome.tabs.sendMessage(tab.id, 'ml-status', (res) => {
      const ok = !chrome.runtime.lastError && res && res.marketplace;
      document.body.classList.toggle('sem-dados', !ok);
      pintarEstagios(ok ? new Map(res.classificados) : null);
    });
  });
};

let saveTimer = null;
const salvar = () => {
  pintarEstagios(); // o estado dos pontinhos responde na hora, sem esperar a aba
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const settings = {};
    for (const key of CHECKBOXES) settings[key] = el(key).checked;
    for (const key of TEXTS) settings[key] = el(key).value;
    // o content script reaplica com debounce de 250ms — esperar um pouco mais que isso
    // faz os números virem já atualizados
    chrome.storage.sync.set(settings, () => setTimeout(atualizarContagens, 350));
  }, 300);
};

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const key of CHECKBOXES) el(key).checked = settings[key];
  for (const key of TEXTS) el(key).value = settings[key];
  atualizarContagens();
});

// Limpa os valores de quem já usou a versão que tinha campos de preço no popup —
// hoje a faixa vem só do filtro do Facebook.
chrome.storage.sync.remove(['minPrice', 'maxPrice']);

for (const key of [...CHECKBOXES, ...TEXTS]) el(key).addEventListener('input', salvar);
