# clip-snip — Especificação v0.1

> Status: **rascunho aprovado** · Versão alvo: **v0.1** · Licença: **GPL-3.0** · Nome provisório

## 1. Visão geral

**clip-snip** é um aplicativo de desktop para recortar um ou vários **micro-clipes** de gravações de jogos — principalmente os replays do OBS — e exportá-los prontos para compartilhar, com destaque para o limite de upload gratuito do Discord (**20 MB**).

O fluxo central:

1. Abrir um vídeo (replay do OBS, NVIDIA app ou qualquer outro).
2. Escolher quais **faixas de áudio** entram (jogo, Discord, navegador, microfone…) e ajustar o **volume** de cada uma, ouvindo a mixagem ao vivo.
3. Marcar **um ou vários trechos**.
4. Escolher um **preset** (ex.: *Discord 20 MB*) e exportar — cada trecho como arquivo separado ou todos juntos num clipe.
5. O arquivo vai para a área de transferência, pronto para colar no Discord.

### 1.1 Problema

- Replays do OBS/NVIDIA são grandes (centenas de MB a GB) e têm várias faixas de áudio.
- O Discord gratuito aceita no máximo 20 MB por arquivo e toca só a **primeira** faixa de áudio.
- Fazer isso hoje exige um editor de vídeo pesado ou comandos FFmpeg manuais, com tentativa e erro até caber no limite.

### 1.2 Objetivos da v0.1

- Do vídeo aberto ao clipe colado no Discord em **menos de 1 minuto** para um corte simples.
- **Nunca** entregar um arquivo acima do limite do preset.
- Funcionar em **Windows, Linux e macOS**, em PCs com ou sem GPU dedicada.
- Interface em **inglês e português**, seguindo o idioma do sistema.

### 1.3 Fora de escopo da v0.1

Ver [Roadmap](#13-roadmap-pós-v01). Em resumo: efeitos, texto, recorte vertical, transições, GIF/WebM, webhook, galeria de pastas, auto-atualização.

## 2. Usuários

| Perfil | Necessidade |
|---|---|
| Jogador que grava com OBS (replay buffer, multifaixa) | Cortar o momento, tirar o Discord do áudio, mandar no servidor |
| Jogador com NVIDIA app / outros gravadores | Mesmo fluxo, com 1–2 faixas sem nome |
| Amigos em sistemas diferentes | Instalar e usar sem configurar FFmpeg ou codecs |

## 3. Plataformas e distribuição

| Item | Decisão |
|---|---|
| Sistemas | Windows x64, Linux x64 (`.AppImage` e `.deb`), macOS universal (Intel + Apple Silicon, `.dmg`) |
| Build | GitHub Actions gera os instaladores dos 3 sistemas a cada release |
| Assinatura de código | **Não** na v0.1. O README explica como passar pelo SmartScreen (Windows) e pelo Gatekeeper (macOS) |
| Atualizações | O app consulta o GitHub Releases e **avisa** quando há versão nova (link para download). Sem auto-instalação |
| Repositório | Público no GitHub, licença **GPL-3.0** |

## 4. Arquitetura

```
┌──────────────────────────────── clip-snip (Tauri v2) ────────────────────────────────┐
│                                                                                       │
│  UI (React + TypeScript + Vite + Tailwind + Zustand)                                  │
│   ├─ Player (<video> sem som)  ─┐                                                     │
│   ├─ Mixer (Web Audio: 1 fonte por faixa, ganho por faixa) ─ sincronizado ao player   │
│   ├─ Linha do tempo (cortes, forma de onda)                                           │
│   ├─ Lista de cortes · Presets · Fila de exportação · Configurações                   │
│   └─ i18n (en, pt-BR)                                                                 │
│                      │  comandos/eventos Tauri (IPC)                                  │
│  Núcleo (TypeScript, sem dependência de UI)                                           │
│   ├─ Cálculo de bitrate e escada de resolução                                         │
│   ├─ Montagem de comandos FFmpeg (puro, testável)                                     │
│   └─ Modelo de projeto (vídeo, faixas, cortes, preset)                                │
│                      │                                                                │
│  Backend (Rust)                                                                       │
│   ├─ Provisionamento do FFmpeg (detectar / baixar / verificar SHA-256)                │
│   ├─ Execução de processos FFmpeg/ffprobe + progresso + cancelamento                  │
│   ├─ Fila de exportação                                                               │
│   ├─ Área de transferência de arquivos (Windows / macOS / Linux)                      │
│   └─ Persistência (pasta de dados do app)                                             │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Princípio:** a lógica de vídeo (núcleo) não conhece a interface. Se o Tauri não se mostrar adequado, a UI e o backend podem ser trocados por **Electron** reaproveitando o núcleo.

## 5. Requisitos funcionais

### 5.1 Abrir vídeos

- **FR-1** Abrir por **arrastar e soltar**, botão **Abrir** e lista de **Recentes**.
- **FR-2** Aceitar qualquer vídeo que o FFmpeg leia. Ler as faixas com `ffprobe`:
  - usar o **nome da faixa** quando existir (ex.: OBS: *Mix, Jogo, Discord, Navegador, Microfone, Sistema*);
  - senão, exibir **"Faixa 1, 2…"**.
- **FR-3** Detectar **HDR** (PQ/HLG), **fps** e **resolução** da fonte.

### 5.2 Prévia

- **FR-4** Tocar o vídeo original no player, **sem som**.
- **FR-5** Ao abrir, extrair cada faixa de áudio para um arquivo leve temporário e tocá-las via **Web Audio**, sincronizadas com o vídeo.
- **FR-6** Se o sistema não conseguir decodificar o vídeo (ex.: AV1 em macOS anterior ao M3, Linux sem codecs), gerar uma **prévia H.264 540p** e exibir um aviso explicando o motivo. A **exportação sempre usa o arquivo original**.

### 5.3 Faixas e mixagem

- **FR-7** Para cada faixa: **ativar/desativar** e **volume** (0–200%), com efeito imediato na prévia.
- **FR-8** As escolhas de faixa e volume valem para **todos os cortes do vídeo** (modelo de dados preparado para ajuste por corte no futuro).
- **FR-9** Forma de onda da **mixagem atual** sob a linha do tempo.

### 5.4 Marcação de cortes

- **FR-10** Criar cortes de três formas: teclas **I/O**, **arrastando** na linha do tempo e pela **lista lateral**.
- **FR-11** Na lista: renomear, ajustar início/fim numericamente, reordenar, apagar.
- **FR-12** Dicas de atalho visíveis na interface (barra de atalhos / tooltips).

| Atalho | Ação |
|---|---|
| `Espaço` / `K` | Tocar / pausar |
| `J` / `L` | Voltar / avançar (repetir acelera) |
| `←` / `→` | 1 frame |
| `Shift+←` / `Shift+→` | 1 segundo |
| `I` / `O` | Marcar início / fim do corte |
| `Enter` | Confirmar corte |
| `Delete` | Apagar corte selecionado |
| `Ctrl/Cmd+E` | Exportar |

### 5.5 Persistência

- **FR-13** Cortes, faixas e volumes são **salvos automaticamente** por vídeo, num JSON na pasta de dados do app. Nada é gravado ao lado dos vídeos do usuário.
- **FR-14** O vídeo é identificado por **caminho + tamanho + data de modificação**.

### 5.6 Exportação

- **FR-15** Modo de saída:
  - **Separados** (padrão): um arquivo por corte;
  - **Montagem**: todos os cortes, na ordem da lista, num único arquivo, com **corte seco**.
- **FR-16** Presets:

| Preset | Codec vídeo | Áudio | Limite | Observações |
|---|---|---|---|---|
| **Discord 20 MB** *(padrão)* | H.264 | AAC estéreo, 1 faixa mixada | 20 MB | Máxima compatibilidade (inclusive celulares) |
| Discord 20 MB · AV1 | AV1 | AAC, 1 faixa mixada | 20 MB | ~30–40% mais qualidade; pode não tocar em celulares antigos |
| Nitro Basic 50 MB | H.264 | AAC, 1 faixa mixada | 50 MB | |
| Nitro 500 MB | H.264 | AAC, 1 faixa mixada | 500 MB | |
| Sem limite | AV1 (qualidade constante) | AAC; opção **manter faixas separadas** | — | Mantém HDR e fps originais |
| Original, sem recodificar | cópia | cópia das faixas escolhidas | — | Instantâneo, sem perda; corte ajustado ao keyframe; sem mixagem/volume |

- **FR-17** Formato de saída: **MP4** com `+faststart`.
- **FR-18** **Fila de exportação** em segundo plano, com progresso e cancelamento por item; o usuário continua editando enquanto exporta.
- **FR-19** Destino padrão: pasta de vídeos do sistema + `Clips` (`Vídeos\Clips`, `~/Movies/Clips`, `~/Videos/Clips`), configurável.
- **FR-20** Nome do arquivo: `<vídeo original> - <nome do corte>.mp4`; sem nome, `<vídeo original> - 00m12s-00m40s.mp4`. Nunca sobrescrever: acrescentar ` (2)`, ` (3)`…
- **FR-21** Após exportar: **copiar o arquivo** (não o caminho) para a área de transferência, nos 3 sistemas, e oferecer **Mostrar na pasta**.

## 6. Regras de codificação

### 6.1 Tamanho-alvo garantido

- **Alvo** = 97,5% do limite (ex.: **19,5 MB** para 20 MB). **Limite verificado** = 20 × 10⁶ bytes (interpretação conservadora).
- Orçamento de vídeo:

  ```
  bitrate_video_kbps = (alvo_bytes × 8 / 1000) / duração_s − bitrate_áudio_kbps − overhead_mux
  ```

- **Áudio:** AAC estéreo **128 kbps**; **96 kbps** quando o orçamento de vídeo ficar abaixo de ~2,5 Mbps.
- **Verificação final:** se o arquivo ultrapassar o limite, **recodificar automaticamente** com bitrate reduzido proporcionalmente ao excesso (+ margem), até caber. O usuário nunca recebe um arquivo acima do limite.

### 6.2 Escada de resolução e fps (presets com limite)

Escolher o primeiro degrau cujo bitrate mínimo cabe no orçamento. Nunca aumentar acima da fonte.

| Degrau | Bitrate mínimo H.264 | Bitrate mínimo AV1 |
|---|---|---|
| 1440p60 | 9 Mbps | 5,5 Mbps |
| 1080p60 | 5 Mbps | 3 Mbps |
| 1080p30 | 3 Mbps | 1,8 Mbps |
| 720p30 | abaixo disso | abaixo disso |

- Abaixo de **~1 Mbps**: aviso *"Este corte tem X min; em 20 MB a qualidade ficará baixa — considere encurtar."*
- O usuário pode **travar** resolução/fps manualmente.
- Valores iniciais; serão calibrados com testes de VMAF.

### 6.3 Outras regras

- **FR-22** fps limitado a **60** nos presets com limite; presets sem limite mantêm o original.
- **FR-23** Fonte **HDR** → **tonemapping para SDR (BT.709)** nos presets com limite; preset *Sem limite* mantém HDR.
- **FR-24** Áudio mixado com `amix` respeitando ativação e volumes por faixa (presets com limite sempre geram **1 faixa**).
- **FR-25** Corte com precisão de frame em todos os presets recodificados.

### 6.4 Encoders

- **FR-26** Na primeira execução, testar (≈1 s cada) os encoders disponíveis: **NVENC (NVIDIA) → AMF (AMD) → QuickSync (Intel) → CPU (x264 / SVT-AV1)**.
- **FR-27** Preset *Discord 20 MB* usa por padrão **x264 em 2 passagens (CPU)** — precisão de tamanho e funciona em qualquer PC. GPU disponível como opção "rápida".
- **FR-28** Usuário pode escolher *Automático / GPU / CPU* nas configurações.

## 7. Provisionamento do FFmpeg

- **FR-29** Procurar um FFmpeg/ffprobe no sistema (PATH) com versão e recursos suficientes.
- **FR-30** Se não houver, mostrar tela explicando **por que é necessário**, **de onde vem** e **quanto ocupa**, com botão **Baixar**.
- **FR-31** Baixar uma **versão fixa** (Windows/Linux: builds do BtbN; macOS: build estática definida no código), verificar **SHA-256** e instalar na pasta de dados do app. Nunca baixar "a mais recente" sem verificação.
- **FR-32** Sem FFmpeg funcional, o app não permite abrir vídeos, mas continua mostrando a tela de instalação.

## 8. Configurações

| Opção | Padrão |
|---|---|
| Pasta de exportação | `<Vídeos do sistema>/Clips` |
| Preset padrão | Discord 20 MB |
| Encoder | Automático |
| Idioma | Sistema (EN / pt-BR) |
| Tema | Sistema (claro / escuro) |

## 9. Internacionalização

- **FR-33** Textos em arquivos de tradução desde o início; inglês como base, **pt-BR** completo.
- **FR-34** Idioma segue o sistema; troca manual nas configurações.

## 10. Privacidade

- **Zero telemetria.** Nenhuma coleta de uso, analytics ou envio de erros — nunca.
- Conexões de rede apenas: (1) download do FFmpeg, quando o usuário confirma; (2) consulta de versão no GitHub Releases.
- Declarado no README.

## 11. Qualidade e testes

| Camada | Ferramenta | Cobertura mínima |
|---|---|---|
| Núcleo (TS) | Vitest | Cálculo de bitrate, escada de resolução, montagem de comandos FFmpeg por preset, nomes de arquivo |
| Backend (Rust) | `cargo test` | Detecção/verificação do FFmpeg, parsing de progresso, fila |
| Integração | Vitest + FFmpeg real | Exportar clipes sintéticos e verificar tamanho ≤ limite, faixas e duração |
| CI | GitHub Actions | Testes a cada push; build dos instaladores em tags de release |

## 12. Critérios de aceite da v0.1

1. Abrir um replay do OBS (AV1, 6 faixas) e ver os nomes das faixas.
2. Desativar *Discord*, aumentar *Jogo* e ouvir a diferença na prévia em tempo real.
3. Marcar 3 cortes com `I`/`O` e exportar como **separados** e como **montagem**.
4. Todos os arquivos do preset *Discord 20 MB* com **≤ 20 MB**, 1 faixa de áudio, H.264, tocando no Discord desktop e mobile.
5. Colar o clipe no Discord com `Ctrl/Cmd+V` logo após exportar.
6. Fonte HDR exportada para Discord sem cores lavadas.
7. Fechar e reabrir o app: cortes do vídeo continuam lá.
8. Instalar e usar em Windows, Linux e macOS sem FFmpeg pré-instalado.
9. Funcionar em PC **sem GPU dedicada** (encoder CPU).
10. Interface em pt-BR num sistema em português e em inglês num sistema em inglês.

## 13. Roadmap (pós-v0.1)

| Funcionalidade | Origem |
|---|---|
| Recorte vertical 9:16, câmera lenta, texto/legenda, fade | Escopo de edição |
| Envio via **webhook** do Discord (arquitetura de "destinos" já prevista) | Pós-exportação |
| Faixas e volumes **por corte** | Mixagem |
| Transições na montagem (fade / crossfade) | Montagem |
| **Galeria** com miniaturas de uma pasta (ex.: `F:\OBS Replays`) | Abertura |
| Formatos **GIF** e WebM | Saída |
| Forma de onda **por faixa** | Linha do tempo |
| **Auto-atualização** (Tauri updater) | Distribuição |
| Assinatura de código (Windows / macOS) | Distribuição |
| "Modo biblioteca" (compressão em lote) — projeto separado | Fora do app |

## 14. Riscos e pontos a validar

| Risco | Mitigação |
|---|---|
| Sincronia vídeo × Web Audio em clipes longos | Ressincronizar a cada seek/pausa; teste de deriva em 3 min |
| Decodificação AV1 nos WebViews (macOS/Linux) | Prévia H.264 automática (FR-6) |
| Precisão do tamanho com encoders de GPU | x264 2 passagens como padrão; recodificação automática (6.1) |
| Copiar arquivo para a área de transferência no Linux (Wayland/X11) | Implementar `text/uri-list`; fallback *Mostrar na pasta* |
| Licenciamento do FFmpeg (GPL) | App GPL-3.0; FFmpeg baixado separadamente com aviso de licença |
| Interpretação de "20 MB" pelo Discord (MB vs MiB) | Verificar contra 20 × 10⁶ bytes (conservador) |

## 15. Decisões registradas

| # | Decisão |
|---|---|
| Stack | Tauri v2 + React/TS direto (sem protótipo PySide6); núcleo isolado para permitir troca por Electron |
| Saída de múltiplos cortes | Separados (padrão) ou montagem |
| Limites | Presets; *Discord 20 MB* padrão |
| Entrada | Qualquer vídeo; nomes de faixa quando existirem |
| Áudio | Mixado em 1 faixa nos presets com limite; separadas opcionais no *Sem limite* |
| Plataformas | Windows, Linux, macOS desde a v0.1 |
| Encoders | Detecção automática com fallback para CPU |
| FFmpeg | Do sistema, ou download na primeira execução com explicação |
| Licença | GPL-3.0 |
| Idiomas | EN + pt-BR, seguindo o sistema |
| Pós-exportação | Copiar arquivo + mostrar na pasta; webhook depois |
| Codec padrão Discord | H.264; AV1 opcional |
| Telemetria | Nenhuma, nunca |
| Publicação | Repositório local primeiro; público após aprovação |
