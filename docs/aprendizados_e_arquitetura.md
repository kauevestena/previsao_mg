# Arquitetura, Generalização Cartográfica e Aprendizados

Este documento reúne o que foi aprendido e implementado durante o desenvolvimento do visualizador coroplético serverless de temperaturas para os **853 municípios de Minas Gerais**.

## 1. Migração para Minas Gerais (853 Municípios) e Generalização Cartográfica Estadual

Minas Gerais (UF código `31`) é o estado brasileiro com o maior número de municípios (**853 municípios**). Renderizar uma malha vetorial de 853 polígonos diretamente no navegador exige atenção especial à **generalização cartográfica** para evitar sobrecarga de rede e lentidão na GPU/WebGL do cliente.

### Estratégia de Generalização Cartográfica Compatível com Escala Estadual
Aplicamos generalização em três níveis complementares:

1. **Generalização Topológica na Fonte (API de Malhas v3 do IBGE - `qualidade=minima`)**:
   - Enquanto a malha de qualidade intermediária de Minas Gerais possui **79.454 vértices** (~1,78 MB apenas de geometria bruta), a malha generalizada para escala estadual (`qualidade=minima`) reduz a complexidade para **18.600 vértices** (~488 KB), preservando a conectividade topológica entre as divisas municipais (sem gerar buracos ou sobreposições entre polígonos vizinhos).
2. **Quantização de Coordenadas e Remoção de Vértices Redundantes (`generalize_ring` em `scripts/update_temperatures.py`)**:
   - As coordenadas geográficas `[lon, lat]` foram truncadas para **4 casas decimais** (resolução espacial de ~11 metros no equador, amplamente superior ao limiar visual de um mapa em escala estadual `1:2.500.000` a `1:5.000.000`).
   - Vértices consecutivos que se tornam idênticos após o arredondamento são removidos automaticamente, garantindo o fechamento válido de cada anel (`ring[0] == ring[-1]`) e serialização JSON compacta (`separators=(",", ":")`).
   - Com isso, o arquivo final [`data/minas_gerais_municipios.geojson`](../data/minas_gerais_municipios.geojson) contendo as geometrias dos **853 municípios + todas as propriedades meteorológicas** ocupa apenas **~634 KB**.
3. **Simplificação Dinâmica em Nível de Tile no MapLibre GL (`tolerance: 0.35`)**:
   - Na configuração da fonte GeoJSON do MapLibre (`app.js`), definimos `tolerance: 0.35` (algoritmo Douglas-Peucker interno do `geojson-vt`) e espessura de borda adaptativa por nível de zoom (`interpolate` entre `0.4px` no zoom 5 e `1.6px` no zoom 11), evitando poluição visual das divisas quando o estado inteiro está enquadrado.

## 2. Coleta Meteorológica: Do Bloqueio no Simepar para a API Pública Open-Meteo

- Durante a fase inicial do experimento, verificamos que as páginas de previsão por município do Simepar (`https://www.simepar.br/simepar/forecast_by_counties/...`) estavam protegidas pelo desafio interativo anti-bot **Cloudflare Managed Challenge / Turnstile** (`HTTP 403 Forbidden`), inviabilizando a coleta automatizada em background via GitHub Actions.
- Ao adotarmos a API pública **Open-Meteo (`https://api.open-meteo.com/v1/forecast`)**, passamos a ter cobertura nacional aberta e sem bloqueios anti-bot, o que permitiu expandir o projeto para todos os **853 municípios de Minas Gerais**.
- O script [`scripts/update_temperatures.py`](../scripts/update_temperatures.py) calcula o centroide (`lat`, `lon`) de cada um dos 853 polígonos e realiza consultas em lote (11 lotes de até 80 municípios em paralelo com `ThreadPoolExecutor`), atualizando temperatura atual (`temp_atual`), mínima (`temp_min`) e máxima (`temp_max`) de todo o estado em cerca de **3,5 segundos**.

## 3. Visualização com MapLibre GL JS e Rampa Contínua Viridis

No frontend serverless (`index.html`, `style.css` e `app.js`):
- **Rampa de Cores Contínua (`viridis`)**:
  Utilizamos a expressão nativa `["interpolate", ["linear"], ["get", metric], ...]` do MapLibre GL com os 5 pontos de parada da escala científica **Viridis**:
  - `0%`: `#440154` (Roxo escuro)
  - `25%`: `#3b528b` (Azul índigo)
  - `50%`: `#21918c` (Verde-azulado / Teal)
  - `75%`: `#5ec962` (Verde claro)
  - `100%`: `#fde725` (Amarelo vibrante)
- **Seletor de Métrica**: Alterna instantaneamente entre `temp_atual` (Temperatura Atual), `temp_min` (Mínima) e `temp_max` (Máxima), recalculando a escala de cores com base nos extremos reais do estado de Minas Gerais.
- **Alternância de Tema (Claro / Escuro) e Novo Mapa Base Sem API Key**:
  - **Substituição do Positron / Carto**: Como serviços baseados em Positron/ OpenMapTiles passaram a exigir chave de API, adotamos os serviços públicos abertos **Esri World Dark Gray Canvas** e **Esri World Light Gray Canvas** (`ArcGIS REST MapServer`), separando as camadas de base (`Base`) e de rótulos (`Reference`) para que a camada de sombreado de relevo (`hillshade`) e o preenchimento coroplético fiquem posicionados entre o fundo cartográfico e os nomes das cidades.
  - **Aprendizado com `map.setStyle()` no MapLibre GL**: Chamar `map.setStyle(url)` para trocar entre os estilos claro e escuro remove todas as fontes (`sources`) e camadas (`layers`) customizadas (como o GeoJSON coroplético e o DEM), além de o evento `style.load` nem sempre disparar de forma determinística em trocas rápidas de tema.
  - **Solução**: Declaramos um único objeto `style` inicial contendo as camadas `basemap-dark` / `basemap-light` e `basemap-dark-labels` / `basemap-light-labels`. Na troca de tema, alternamos instantaneamente a propriedade `visibility` (`visible` / `none`) via `map.setLayoutProperty()`, preservando o GeoJSON e o terreno 3D intactos na GPU.

## 4. Integração de Relevo (Terrain 3D + Sombreado Hillshade) via Serviço Público

- **Fonte Pública de Elevação (DEM)**: Integramos os tiles globais **Mapzen Terrarium** hospedados gratuitamente no **AWS Registry of Open Data** (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, codificação `terrarium`), que não exigem chave de API e possuem suporte completo a CORS.
- **Dupla Representação Topográfica (3D + Hillshade)**:
  1. **Terreno 3D (`map.setTerrain`)**: Extrusão tridimensional da superfície do mapa com `exaggeration: 2.2` e inclinação inicial (`pitch: 32°`), destacando feições como a Serra da Mantiqueira, Serra do Espinhaço e Serra da Canastra e sua relação direta com as temperaturas mais amenas em Minas Gerais.
  2. **Sombreado de Relevo (`hillshade`)**: Camada `relief-hillshade` posicionada sobre o mapa base para evidenciar o relevo mesmo quando o mapa é visto de cima (`pitch: 0°`).
- **Ativação e Desativação Interativa**: O relevo inicia **ativado por padrão** e pode ser ativado ou desativado a qualquer momento tanto pelo botão **"Visualização de Relevo (DEM)"** no painel lateral quanto pelo botão `TerrainControl` nativo no canto inferior direito do mapa (ambos sincronizados pelo evento `terrain`).

## 5. Atualização Serverless a cada 5 minutos (GitHub Actions)

O workflow [`.github/workflows/update_temperatures.yml`](../.github/workflows/update_temperatures.yml) executa a cada 5 minutos (`cron: "*/5 * * * *"`), atualizando [`data/minas_gerais_municipios.geojson`](../data/minas_gerais_municipios.geojson) e realizando commit/push automático caso os valores de temperatura tenham mudado.
