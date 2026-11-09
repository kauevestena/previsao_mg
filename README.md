# Mapa Coroplético de Temperaturas de Minas Gerais (MapLibre GL)

Visualizador web **serverless** em mapa coroplético para exibição das temperaturas (**Atual**, **Mínima** e **Máxima**) dos **853 municípios do estado de Minas Gerais**, utilizando **MapLibre GL JS**, malha municipal oficial do **IBGE** com **generalização cartográfica estadual** (`.geojson`), coleta meteorológica via **Open-Meteo API** e a rampa de cores contínua **Viridis**.

---

## Funcionalidades Implementadas

- **Mapa Coroplético Interativo de Minas Gerais (MapLibre GL JS)**:
  - Polígonos dos **853 municípios de Minas Gerais** armazenados em [`data/minas_gerais_municipios.geojson`](data/minas_gerais_municipios.geojson).
  - **Generalização Cartográfica Estadual**: Combina a malha generalizada do IBGE (`qualidade=minima`, preservando a topologia entre municípios vizinhos), quantização de coordenadas para 4 casas decimais (~634 KB para todo o estado com dados inclusos) e simplificação de tiles (`tolerance: 0.35`) com espessura de linha adaptativa ao zoom.
  - **Rampa de Cores Contínua Viridis** (`#440154` → `#3b528b` → `#21918c` → `#5ec962` → `#fde725`) interpolada linearmente pelo MapLibre.
- **Seleção de Métrica de Temperatura**:
  - Alternância instantânea entre **Temperatura Atual (`temp_atual`)**, **Temperatura Mínima (`temp_min`)** e **Temperatura Máxima (`temp_max`)**.
- **Alternância de Tema (Claro / Escuro)**:
  - Botão de troca de tema que altera tanto a interface quanto o basemap do MapLibre (`Dark Matter` / `Positron`).
- **Busca com Voo Automático (`flyTo`)**:
  - Busca por qualquer um dos 853 municípios de Minas Gerais pelo nome ou código IBGE (ex.: *Belo Horizonte*, *Uberlândia*, *Juiz de Fora*, *Ouro Preto*), destacando o polígono e centralizando o mapa.
- **Atualização Automática via GitHub Actions**:
  - Workflow em [`.github/workflows/update_temperatures.yml`](.github/workflows/update_temperatures.yml) agendado para rodar a cada 5 minutos (`*/5 * * * *`).

---

## Estrutura do Projeto

```text
├── .github/
│   └── workflows/
│       └── update_temperatures.yml     # GitHub Actions (execução a cada 5 minutos)
├── data/
│   └── minas_gerais_municipios.geojson # 853 municípios de MG generalizados + temperaturas
├── docs/
│   └── aprendizados_e_arquitetura.md   # Documentação sobre generalização cartográfica e arquitetura
├── scripts/
│   └── update_temperatures.py          # Download da malha IBGE de MG, generalização e coleta Open-Meteo
├── index.html                          # Interface principal do visualizador
├── style.css                           # Estilos, temas (claro/escuro) e barra contínua Viridis
├── app.js                              # Lógica do MapLibre GL JS e filtros de temperatura
└── requirements.txt                    # Dependências Python do coletor
```

---

## Como Executar Localmente

1. **Atualizar os dados meteorológicos no GeoJSON**:
   ```bash
   pip install -r requirements.txt
   python3 scripts/update_temperatures.py
   ```

2. **Servir os arquivos estáticos**:
   ```bash
   python3 -m http.server 8000
   ```
   Em seguida, acesse `http://localhost:8000` no navegador.

---

## Documentação e Aprendizados

Todos os detalhes técnicos sobre a **generalização cartográfica para escala estadual**, a migração para os **853 municípios de Minas Gerais**, o bloqueio anti-bot inicial no Simepar e a coleta em lote via **Open-Meteo API** estão documentados em [`docs/aprendizados_e_arquitetura.md`](docs/aprendizados_e_arquitetura.md).
