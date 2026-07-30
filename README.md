# 🧹 Marketplace Limpo

Extensão de navegador que limpa a busca do **Facebook Marketplace** direto na página. Não usa API nenhuma (o Facebook não tem API pública de Marketplace) — só filtra os cards de resultado no DOM, na sua própria sessão logada.

## Filtros

- **Ocultar patrocinados** — some com os cards marcados como "Patrocinado". O FB ofusca esse rótulo de propósito (intercala letras falsas em spans escondidos e embaralha a ordem dos pedaços com `order` do flexbox), então a leitura reconstrói o texto **visível** do card antes de comparar. A varredura é feita sobre as células da grade, não sobre os links — assim o que some é sempre o card inteiro, e não o pedacinho onde o rótulo por acaso estava. Pega também os patrocinados que levam pra fora do Facebook, que não têm link de item e por isso escapavam do filtro.
- **Match exato** — esconde anúncios que não contêm todas as palavras da sua busca (a maior fonte de lixo: o FB adora mostrar coisa vagamente relacionada). Conectivos ("de", "com", "para"...) são ignorados.
- **Palavras proibidas** — blacklist livre, uma por linha ("aceito troca", "leia a descrição", "defeito"...). Casa **palavra inteira**: `ar` derruba "câmara de ar" e não encosta em "escape dizars" nem em "câmara". Por isso plural não vem de graça — `defeito` não pega "defeitos"; ponha as duas formas se quiser as duas.
- **Faixa de preço real** — a extensão **reforça** nos cards a faixa que você setou no filtro do próprio FB (params `minPrice`/`maxPrice` da URL), que o FB nem sempre respeita. Não há campo de preço no popup: a faixa é sempre a do Facebook.
- **Dedupe** — esconde anúncios repetidos (mesmo texto/preço apareceu antes na lista).
- **Sem buracos na grade** — o que é filtrado some junto com a célula da grade, então os outros cards reocupam o espaço em vez de deixar um vão em branco.

Quando algo é filtrado, aparece uma pílula **"🧹 N filtrados"** no canto inferior esquerdo. Clique nela para revelar temporariamente os itens ocultos (aparecem esmaecidos com contorno vermelho tracejado) e clique de novo para escondê-los. **Passe o mouse por cima** para ver a quebra por motivo ("3 patrocinados, 8 fora da busca...") — é o jeito rápido de saber qual filtro está agindo.

### Como os filtros se combinam

Cada card recebe **um único motivo**, sempre o primeiro que se aplica, nesta ordem:

`patrocinado` → `palavra proibida` → `fora da busca` → `fora da faixa de preço` → `duplicado`

Essa classificação é calculada **independente dos toggles** — eles só decidem quais motivos escondem. Um patrocinado que também está fora da busca fica classificado como patrocinado e nada mais; desligar "ocultar patrocinados" faz ele reaparecer, em vez de o filtro seguinte recolhê-lo e o toggle parecer morto.

A contrapartida de "um card, um motivo": quem já foi classificado não entra no dedupe. Com o match exato **desligado**, dois anúncios idênticos fora da busca aparecem os dois — ambos estão classificados como "fora da busca", não como duplicados.

O popup da extensão (ícone na barra) mostra a cadeia de filtros na ordem em que rodam, com quantos anúncios cada um classificou **na aba aberta agora** — o ponto acende no estágio que está pegando algo. Os interruptores valem na hora, sem recarregar a página. Se a aba ativa não for uma busca do Marketplace, os números não aparecem.

## Instalação

### Chrome / Chromium / Brave / Edge

1. Abra `chrome://extensions`
2. Ligue o **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** → selecione esta pasta

> O Chrome pode avisar que não reconhece a chave `browser_specific_settings` do manifest — é a chave do Firefox, pode ignorar.

### Firefox

1. Abra `about:debugging#/runtime/this-firefox`
2. **Carregar extensão temporária…** → selecione o `manifest.json` desta pasta

(No Firefox a extensão temporária some ao fechar o navegador — para instalar de vez precisaria assinar no AMO.)

## Limitações e avisos

- Funciona em `www.facebook.com` e `web.facebook.com`, interface em **pt-BR** (detecção de "Patrocinado", preço em `R$`, "Grátis"). Para outro idioma/moeda é ajuste pequeno no `content.js`.
- O DOM do Facebook é ofuscado e muda sem aviso. A extensão se apoia no seletor mais estável que existe (`a[href*="/marketplace/item/"]`), mas se um dia parar de filtrar, provavelmente foi mudança de markup. Se os patrocinados voltarem a passar, rode o `diagnostico.js` no console da página de busca: ele mostra quantos cards cada via de detecção (texto cru, `aria-label`, texto visível) está pegando.
- O filtro de preço só atua em card que exibe preço; card sem preço legível não é escondido por esse critério.
- Uso pessoal, automatizando sua própria navegação. Ainda assim, tecnicamente é área cinzenta dos termos de uso do Facebook — use por sua conta.

## Estrutura

```
manifest.json   MV3, roda em facebook.com
content.js      observa o DOM (MutationObserver), classifica e aplica os filtros
content.css     estilos do card oculto/revelado e da pílula contadora
popup.html/js   cadeia de filtros e configurações (chrome.storage.sync)
diagnostico.js  cola no console pra ver o que a detecção de patrocinado enxerga
```

O popup pergunta a classificação à aba ativa (`chrome.tabs.sendMessage` → `content.js`), por isso o `activeTab` no manifest. Sem resposta, ele só esconde os números — nenhuma funcionalidade depende disso.
