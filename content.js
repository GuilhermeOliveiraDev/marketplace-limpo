// Marketplace Limpo — filtra os cards de resultado do Facebook Marketplace direto no DOM.
// Não chama nenhuma API: só observa a página, lê o texto de cada card e esconde o que
// não passa nos filtros configurados no popup.
(() => {
  const DEFAULTS = {
    enabled: true,
    hideSponsored: true,
    exactMatch: true,
    dedupe: true,
    blacklist: '',
  };

  // Palavras curtas/conectivos que não valem como critério de match exato
  // ("mesa de jantar" não pode exigir "de" no título do anúncio).
  const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'com', 'para', 'pra', 'e', 'a', 'o', 'um', 'uma']);

  const ITEM_LINK = 'a[href*="/marketplace/item/"]';
  const SPONSORED = /patrocinad|sponsored|publicidad/;

  // Qual configuração controla a visibilidade de cada motivo. Blacklist e faixa de preço
  // não têm liga/desliga: valem sempre que estão preenchidas.
  const MOTIVO_ATIVO = {
    patrocinados: () => settings.hideSponsored,
    'palavra proibida': () => true,
    'fora da busca': () => settings.exactMatch,
    'fora da faixa de preço': () => true,
    duplicados: () => settings.dedupe,
  };

  let settings = { ...DEFAULTS };
  let pill = null;
  let lastSignature = '';
  let lastTally = new Map(); // motivo -> quantos cards escondidos
  let lastClassified = new Map(); // motivo -> quantos cards classificados, escondidos ou não

  const normalize = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // caracteres invis\u00edveis que o FB injeta no meio de r\u00f3tulos pra despistar adblock
      .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, '');

  // Extrai o primeiro preço do texto do card. "Grátis" conta como 0.
  // Formato pt-BR: "R$ 1.500" / "R$ 1.234,56".
  const parsePrice = (text) => {
    if (/gr[aá]tis|\bfree\b/i.test(text)) return 0;
    const m = text.match(/R\$\s?([\d.]+(?:,\d{1,2})?)/);
    if (!m) return null;
    return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  };

  const getQueryWords = () => {
    const q = new URLSearchParams(location.search).get('query');
    if (!q) return [];
    return normalize(q)
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  };

  const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // A blacklist casa palavra inteira, não pedaço de palavra: "ar" tem que derrubar
  // "camara de ar" e deixar passar "escape dizars" e "camara".
  //
  // A fronteira só considera LETRA quando o termo começa/termina em letra. Motivo: o
  // textContent do card cola os pedaços sem espaço ("R$ 100sofa retratil"), então um
  // dígito grudado antes da palavra não pode invalidar o match. Já um termo que começa
  // em dígito ("12v") usa dígito na fronteira também, pra não casar dentro de "112v".
  const toBlacklistRx = (term) => {
    const left = /^[0-9]/.test(term) ? '(?<![a-z0-9])' : '(?<![a-z])';
    const right = /[0-9]$/.test(term) ? '(?![a-z0-9])' : '(?![a-z])';
    return new RegExp(left + escapeRx(term) + right);
  };

  const getBlacklist = () =>
    settings.blacklist
      .split('\n')
      .map((w) => normalize(w.trim()))
      .filter(Boolean)
      .map(toBlacklistRx);

  // Sobe do <a> do card até a "célula" da grade (o ancestral mais alto que ainda contém
  // só esse anúncio). Esconder a célula — e não o <a> lá dentro — faz a grade reocupar
  // o espaço, sem deixar buraco onde o card estava.
  const linkCount = (el, cache) => {
    let n = cache.get(el);
    if (n === undefined) {
      n = el.querySelectorAll(ITEM_LINK).length;
      cache.set(el, n);
    }
    return n;
  };

  const getCell = (card, cache) => {
    let el = card;
    for (let i = 0; i < 12 && el.parentElement; i++) {
      const parent = el.parentElement;
      if (parent === document.body || parent.tagName === 'MAIN') break;
      if (linkCount(parent, cache) > 1) return el;
      el = parent;
    }
    return card; // não achou a grade — esconder só o link é mais seguro que sumir com a página
  };

  // O container da grade é o pai que mais se repete entre as células encontradas acima.
  // Com ele em mãos dá pra tratar QUALQUER filho dele como um card — inclusive o
  // patrocinado que não é anúncio do Marketplace e não tem link de item pra servir
  // de âncora.
  const findGrid = (cells) => {
    const tally = new Map();
    for (const cell of cells) {
      const parent = cell.parentElement;
      if (parent) tally.set(parent, (tally.get(parent) || 0) + 1);
    }
    let grid = null;
    let best = 1; // menos de 2 células não é grade
    for (const [parent, n] of tally) {
      if (n > best) {
        best = n;
        grid = parent;
      }
    }
    return grid;
  };

  // --- Rótulo "Patrocinado" -------------------------------------------------
  // O FB ofusca esse rótulo de propósito: intercala spans escondidos com letras falsas
  // e usa `order` do flexbox pra embaralhar a ordem dos pedaços no DOM. Resultado:
  // `textContent` devolve algo como "Paxtroycinaqdo" (ou fora de ordem) e a regex não
  // pega nada. A leitura abaixo reconstrói o que o olho realmente lê na tela.
  const isHiddenEl = (el, cs) =>
    cs.display === 'none' ||
    cs.visibility === 'hidden' ||
    parseFloat(cs.opacity) === 0 ||
    el.getAttribute('aria-hidden') === 'true' ||
    // caixa de tamanho zero com o excedente cortado — decoy clássico
    (cs.overflow !== 'visible' && (cs.height === '0px' || cs.width === '0px')) ||
    // jogado pra fora da tela ou recortado a zero
    parseFloat(cs.left) < -5000 ||
    parseFloat(cs.top) < -5000 ||
    /^rect\((0p?x?,\s*){3}0p?x?\)$/.test(cs.clip);

  // Texto que só existe no CSS (`content: "Patrocinado"` num ::before). Não está no
  // DOM, então nem textContent nem os nós de texto o alcançam — mas o olho lê.
  const pseudoText = (el, qual) => {
    const c = getComputedStyle(el, qual).content;
    if (!c || c === 'none' || c === 'normal') return '';
    const m = c.match(/^"([\s\S]*)"$/); // string literal vem entre aspas no valor computado
    return m ? m[1] : '';
  };

  const visibleText = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const cs = getComputedStyle(node);
    if (isHiddenEl(node, cs)) return '';

    let kids = [...node.childNodes];
    if (kids.length > 1 && /flex|grid/.test(cs.display)) {
      // `order` só vale dentro de flex/grid. Nó de texto vira item anônimo, order 0.
      const ordered = kids.map((n) => ({
        n,
        o: n.nodeType === Node.ELEMENT_NODE ? parseInt(getComputedStyle(n).order, 10) || 0 : 0,
      }));
      // sort é estável: quem empata em `order` mantém a ordem do DOM
      if (ordered.some((x) => x.o !== 0)) kids = ordered.sort((a, b) => a.o - b.o).map((x) => x.n);
    }
    return pseudoText(node, '::before') + kids.map(visibleText).join('') + pseudoText(node, '::after');
  };

  // Reconstruir o texto visível custa um getComputedStyle por elemento da subárvore,
  // e o MutationObserver dispara o tempo todo — daí o cache por célula, invalidado
  // por uma assinatura barata do conteúdo.
  const sponsoredCache = new WeakMap();

  const isSponsored = (cell) => {
    const raw = cell.textContent || '';
    if (SPONSORED.test(normalize(raw))) return true;
    if (
      [...cell.querySelectorAll('[aria-label]')].some((el) =>
        SPONSORED.test(normalize(el.getAttribute('aria-label')))
      )
    )
      return true;

    const sig = `${raw.length}:${cell.childElementCount}`;
    const cached = sponsoredCache.get(cell);
    if (cached && cached.sig === sig) return cached.value;
    const value = SPONSORED.test(normalize(visibleText(cell)));
    sponsoredCache.set(cell, { sig, value });
    return value;
  };

  const ensurePill = () => {
    if (pill && document.body.contains(pill)) return pill;
    pill = document.createElement('div');
    pill.id = 'ml-pill';
    pill.addEventListener('click', () => {
      document.documentElement.classList.toggle('ml-reveal');
      updatePill(countHidden());
    });
    document.body.appendChild(pill);
    return pill;
  };

  const countHidden = () => document.querySelectorAll('.ml-hidden').length;

  const updatePill = (count) => {
    ensurePill();
    pill.style.display = count > 0 ? 'block' : 'none';
    const revealing = document.documentElement.classList.contains('ml-reveal');
    // Quebrar por motivo responde na hora "qual filtro está agindo?" — sem isso, um
    // anúncio pego pelo match exato é indistinguível de um pego por patrocinado.
    const detalhe = [...lastTally].map(([motivo, n]) => `${n} ${motivo}`).join(', ');
    const assinatura = `${count}|${revealing}|${detalhe}`;
    if (assinatura === lastSignature) return; // não reescrever à toa (evita loop com o MutationObserver)
    lastSignature = assinatura;
    pill.textContent = revealing ? `🧹 ${count} filtrados (mostrando)` : `🧹 ${count} filtrados`;
    pill.title = detalhe
      ? `${detalhe} — clique para revelar/ocultar`
      : 'Marketplace Limpo — clique para revelar/ocultar os itens filtrados';
  };

  const unhideAll = () => {
    document.querySelectorAll('.ml-hidden').forEach((el) => el.classList.remove('ml-hidden'));
  };

  const applyFilters = () => {
    if (!location.pathname.includes('/marketplace')) {
      unhideAll();
      if (pill) pill.style.display = 'none';
      return;
    }
    if (!settings.enabled) {
      unhideAll();
      lastTally = new Map();
      updatePill(0);
      return;
    }

    const root = document.querySelector('[role="main"]') || document.body;
    // Os critérios são avaliados sempre, independente dos toggles: o card recebe um
    // motivo fixo e só depois se decide se esse motivo esconde ou não.
    const words = getQueryWords();
    const blacklist = getBlacklist();
    // Preço: a faixa vem sempre do filtro do próprio Facebook (params minPrice/maxPrice
    // da URL), que o FB nem sempre respeita nos resultados — aqui ela é reforçada.
    const params = new URLSearchParams(location.search);
    const min = parseFloat(params.get('minPrice')) || null;
    const max = parseFloat(params.get('maxPrice')) || null;
    const seen = new Set();
    const cellCache = new Map();
    // Decide tudo primeiro e só depois aplica as classes: intercalar escrita com
    // getComputedStyle obrigaria o navegador a recalcular o layout a cada card.
    // O valor é o MOTIVO (ou null pra manter visível), que alimenta o resumo da pílula.
    const decisions = new Map();
    const decide = (cell, motivo) => decisions.set(cell, decisions.get(cell) || motivo);

    const itemLinks = [...root.querySelectorAll(ITEM_LINK)];
    const itemCells = itemLinks.map((card) => getCell(card, cellCache));
    const grid = findGrid(itemCells);

    itemLinks.forEach((card, i) => {
      const cell = itemCells[i];
      const rawText = card.textContent || '';
      const text = normalize(rawText);
      // Cada card fica com o PRIMEIRO motivo que se aplica, nesta ordem — e essa
      // classificação não muda com os toggles. Patrocinado continua classificado como
      // patrocinado mesmo com o filtro desligado; nesse caso ele reaparece, em vez de
      // ser recolhido pelo critério seguinte.
      let motivo = null;

      // O rótulo "Patrocinado" costuma ficar FORA do <a>, em outro elemento da célula —
      // por isso a checagem é na célula inteira, não no link.
      if (isSponsored(cell)) motivo = 'patrocinados';
      if (!motivo && blacklist.some((rx) => rx.test(text))) motivo = 'palavra proibida';
      if (!motivo && words.length > 0 && !words.every((w) => text.includes(w))) motivo = 'fora da busca';
      if (!motivo && (min !== null || max !== null)) {
        const price = parsePrice(rawText);
        if (price !== null && ((min !== null && price < min) || (max !== null && price > max)))
          motivo = 'fora da faixa de preço';
      }
      // Só quem passou por todos os critérios entra no dedupe — assim a primeira cópia
      // "limpa" é que vira a original, e não um patrocinado que nem vai aparecer.
      if (!motivo) {
        if (seen.has(text)) motivo = 'duplicados';
        else seen.add(text);
      }

      decide(cell, motivo);
    });

    // Patrocinado que aponta pra fora do FB não tem link de item, então o laço acima
    // nem o enxerga. Varrer os filhos da grade pega esses também — e sempre esconde a
    // célula inteira, nunca o pedaço onde o rótulo por acaso está. Só o critério de
    // patrocinado vale aqui: sem o rótulo confirmado, nada some.
    if (grid) {
      for (const cell of grid.children) {
        if (decisions.has(cell)) continue; // já resolvido como card de item
        if (linkCount(cell, cellCache) > 1) continue; // bloco maior que um card — não mexe
        decide(cell, isSponsored(cell) ? 'patrocinados' : null);
      }
    }

    // Agora sim os toggles entram: eles decidem quais motivos escondem.
    let hidden = 0;
    const tally = new Map(); // só o que sumiu — é o que a pílula anuncia
    const classified = new Map(); // tudo que foi classificado, sumindo ou não — vai pro popup
    for (const [cell, motivo] of decisions) {
      const hide = !!motivo && MOTIVO_ATIVO[motivo]();
      cell.classList.toggle('ml-hidden', hide);
      if (motivo) classified.set(motivo, (classified.get(motivo) || 0) + 1);
      if (hide) {
        hidden++;
        tally.set(motivo, (tally.get(motivo) || 0) + 1);
      }
    }

    lastTally = tally;
    lastClassified = classified;
    updatePill(hidden);
  };

  // O Marketplace é SPA com scroll infinito: reaplicar (com debounce) a cada mudança no DOM
  // cobre navegação interna e novos cards carregados.
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(applyFilters, 250);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.sync.get(DEFAULTS, (res) => {
    settings = res;
    applyFilters();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue;
    applyFilters();
  });

  // O popup pergunta o que foi classificado nesta aba pra mostrar o número de cada
  // filtro. Se ninguém responder (aba fora do Marketplace), ele simplesmente não mostra.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg !== 'ml-status') return;
    sendResponse({
      marketplace: location.pathname.includes('/marketplace'),
      classificados: [...lastClassified],
    });
  });
})();
