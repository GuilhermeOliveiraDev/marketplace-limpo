// Diagnóstico de patrocinados — Marketplace Limpo
//
// Como usar: abra uma busca do Marketplace onde apareça um card "Patrocinado",
// F12 → aba Console → cole este arquivo inteiro → Enter → me mande a saída.
// (Se o Chrome bloquear o paste, digite "allow pasting" no console primeiro.)
(() => {
  const rx = /patrocinad|sponsored|publicidad/;
  const ITEM = 'a[href*="/marketplace/item/"]';
  const root = document.querySelector('[role="main"]') || document.body;
  const lines = [];

  const normalize = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, '');

  // Mesma leitura "só o que está visível" que o content.js usa: pula elemento
  // escondido e respeita o `order` do flexbox.
  const isHiddenEl = (el, cs) =>
    cs.display === 'none' ||
    cs.visibility === 'hidden' ||
    parseFloat(cs.opacity) === 0 ||
    el.getAttribute('aria-hidden') === 'true' ||
    (cs.overflow !== 'visible' && (cs.height === '0px' || cs.width === '0px')) ||
    parseFloat(cs.left) < -5000 ||
    parseFloat(cs.top) < -5000 ||
    /^rect\((0p?x?,\s*){3}0p?x?\)$/.test(cs.clip);

  const pseudoText = (el, qual) => {
    const c = getComputedStyle(el, qual).content;
    if (!c || c === 'none' || c === 'normal') return '';
    const m = c.match(/^"([\s\S]*)"$/);
    return m ? m[1] : '';
  };

  const visibleText = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const cs = getComputedStyle(node);
    if (isHiddenEl(node, cs)) return '';
    let kids = [...node.childNodes];
    if (kids.length > 1 && /flex|grid/.test(cs.display)) {
      const ordered = kids.map((n) => ({
        n,
        o: n.nodeType === Node.ELEMENT_NODE ? parseInt(getComputedStyle(n).order, 10) || 0 : 0,
      }));
      if (ordered.some((x) => x.o !== 0)) kids = ordered.sort((a, b) => a.o - b.o).map((x) => x.n);
    }
    return pseudoText(node, '::before') + kids.map(visibleText).join('') + pseudoText(node, '::after');
  };

  const getCell = (card) => {
    let el = card;
    for (let i = 0; i < 12 && el.parentElement; i++) {
      const parent = el.parentElement;
      if (parent === document.body || parent.tagName === 'MAIN') break;
      if (parent.querySelectorAll(ITEM).length > 1) return el;
      el = parent;
    }
    return card;
  };

  // [1] o que cada via de detecção enxerga, célula por célula
  const items = [...root.querySelectorAll(ITEM)];
  const cells = items.map(getCell);
  lines.push(`[1] cards de item na área de resultados: ${items.length}`);
  let porTextoCru = 0;
  let porAria = 0;
  let porTextoVisivel = 0;
  const soVisivel = [];

  for (const cell of cells) {
    const cru = rx.test(normalize(cell.textContent || ''));
    const aria = [...cell.querySelectorAll('[aria-label]')].some((el) =>
      rx.test(normalize(el.getAttribute('aria-label')))
    );
    const vis = rx.test(normalize(visibleText(cell)));
    if (cru) porTextoCru++;
    if (aria) porAria++;
    if (vis) porTextoVisivel++;
    if (vis && !cru && !aria && soVisivel.length < 3) soVisivel.push(cell);
  }
  lines.push(`  detectados por texto cru: ${porTextoCru}`);
  lines.push(`  detectados por aria-label: ${porAria}`);
  lines.push(`  detectados por texto visível (ofuscados): ${porTextoVisivel}`);

  soVisivel.forEach((cell, i) => {
    lines.push(`  ofuscado #${i} cru="${(cell.textContent || '').trim().slice(0, 70)}"`);
    lines.push(`  ofuscado #${i} vis="${visibleText(cell).trim().slice(0, 70)}"`);
  });

  // [2] a grade e seus filhos — é assim que a extensão acha os patrocinados que não
  //     são anúncio do Marketplace (não têm link de item pra servir de âncora)
  const tally = new Map();
  for (const cell of cells) {
    const p = cell.parentElement;
    if (p) tally.set(p, (tally.get(p) || 0) + 1);
  }
  let grid = null;
  let best = 1;
  for (const [p, n] of tally) {
    if (n > best) {
      best = n;
      grid = p;
    }
  }

  if (!grid) {
    lines.push('[2] grade NÃO identificada (menos de 2 células com pai em comum)');
  } else {
    const filhos = [...grid.children];
    lines.push(`[2] grade: <${grid.tagName.toLowerCase()}> com ${filhos.length} filhos, ${best} com link de item`);
    lines.push('  célula a célula (ache a linha do anúncio patrocinado que escapou):');
    filhos.forEach((c, i) => {
      const vis = visibleText(c).trim().replace(/\s+/g, ' ');
      const cru = rx.test(normalize(c.textContent || ''));
      const aria = [...c.querySelectorAll('[aria-label]')].some((e) =>
        rx.test(normalize(e.getAttribute('aria-label')))
      );
      lines.push(
        `  [${String(i).padStart(2, '0')}] item=${c.querySelector(ITEM) ? 'sim' : 'NÃO'} ` +
          `cru=${cru ? 'S' : '-'} aria=${aria ? 'S' : '-'} vis=${rx.test(normalize(vis)) ? 'S' : '-'} ` +
          `img=${c.querySelector('img') ? 'sim' : 'não'} svg=${c.querySelector('svg') ? 'sim' : 'não'} ` +
          `"${vis.slice(0, 55)}"`
      );
    });
  }

  // [3] rótulos que existem na página mas não caíram em nenhuma célula acima —
  //     se aparecer algo aqui e nada em [1]/[2], o markup mudou de vez.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode()) {
    if (rx.test(normalize(walker.currentNode.textContent))) hits.push(walker.currentNode.parentElement);
  }
  lines.push(`[3] nós de texto com o rótulo legível: ${hits.length}`);
  hits.slice(0, 5).forEach((el, i) => {
    lines.push(
      `  #${i} tag=${el.tagName} dentroDoLinkDoItem=${!!el.closest(ITEM)} ` +
        `dentroDaGrade=${!!(grid && grid.contains(el))} ` +
        `texto="${(el.textContent || '').trim().slice(0, 50)}"`
    );
  });

  if (!porTextoCru && !porAria && !porTextoVisivel && !hits.length) {
    lines.push(
      '[!] nenhum rótulo encontrado por texto nem por aria — deve estar em SVG, imagem ou shadow DOM; me manda o outerHTML de um card patrocinado'
    );
  }

  console.log(lines.join('\n'));
})();
